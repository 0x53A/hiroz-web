# Upstream report: CDR sequence reserves memory before validating the payload

Verified against hiroz `main` **844e1592802220b3cf024e369436db60991c60fc**,
fetched during the 2026-09-08 review (Europe/Berlin). The WASM branch's CDR
implementation is identical to upstream at the cited sites. This report has
not been posted upstream.

## Expected and observed behavior

Decoding a truncated sequence should return `UnexpectedEof` without first
reserving storage for all the elements advertised by its length prefix.
Currently a four-byte prefix describing 100,000,000 elements is accepted,
and `Vec::<u64>::cdr_deserialize` immediately requests **800,000,000 bytes**.
In a process constrained to 256 MiB of virtual memory, this aborts the process
(exit status 134) rather than returning a decoding error.

This affects native builds too. Browser linear memory limits make the same
allocation strategy especially unsuitable for a long-running groundstation.
No network peer, ROS installation, router, or WASM environment is needed to
reproduce it.

## Minimal reproduction

The standalone Cargo project is in
[`tools/upstream-repros/cdr-sequence`](../../tools/upstream-repros/cdr-sequence).
Its complete decoding code is:

```rust
use hiroz_cdr::{CdrDeserialize, CdrReader, LittleEndian};
let bytes = 100_000_000u32.to_le_bytes();
let mut reader = CdrReader::<LittleEndian>::new(&bytes);
let result = Vec::<u64>::cdr_deserialize(&mut reader);
```

From the parent repository:

```sh
cargo build --manifest-path tools/upstream-repros/cdr-sequence/Cargo.toml
(
  ulimit -c 0
  ulimit -v 262144
  ./tools/upstream-repros/cdr-sequence/target/debug/cdr-sequence-allocation-repro
)
```

The resource limit applies only to that subshell, after compilation. Actual output:

```text
Decoding four bytes as Vec<u64> (run under a memory limit)
memory allocation of 800000000 bytes failed
```

Observed on Linux x86_64. The local reproduction built the CDR crate directly
from the reviewed checkout; the standalone lockfile uses released Zenoh buffer
utilities. The relevant allocation is wholly inside `hiroz-cdr`.

## Cause and affected paths

1. [`CdrReader::read_sequence_length`](https://github.com/ZettaScaleLabs/hiroz/blob/844e1592802220b3cf024e369436db60991c60fc/crates/hiroz-cdr/src/primitives.rs#L357)
   accepts lengths up to **100,000,000 elements**, including exactly that cap.
   It does not establish that any element bytes remain.
2. [`CdrDeserialize for Vec<T>`](https://github.com/ZettaScaleLabs/hiroz/blob/844e1592802220b3cf024e369436db60991c60fc/crates/hiroz-cdr/src/traits.rs#L247)
   calls `Vec::with_capacity(count)` before attempting the first element decode.
   Allocation failure is not represented in the returned `Result`.
3. The same allocation-before-validation pattern exists in
   [generated non-POD sequence decoding](https://github.com/ZettaScaleLabs/hiroz/blob/844e1592802220b3cf024e369436db60991c60fc/crates/hiroz-codegen/src/generator/rust.rs#L407)
   and [dynamic sequence decoding](https://github.com/ZettaScaleLabs/hiroz/blob/844e1592802220b3cf024e369436db60991c60fc/crates/hiroz/src/dynamic/serialization/cdr.rs#L197).
   These additional sites were verified by source inspection, not separately
   exercised with the constrained-process reproduction.

The optimized POD reader is different: `read_pod_slice` checks multiplication
and verifies the byte slice before allocating. Do not generalize this finding
to every generated numeric-array decoder.

## Suggested resolution and acceptance tests

Use a bounded initial capacity for variable-size element decoding, and validate
available input before bulk allocation when a minimum encoded element size is
known. Use fallible reservation and propagate resource-limit errors through the
existing decoding `Result`. An element-count cap alone is not a byte budget;
consider an explicit decoded-memory/element budget for nested dynamic schemas.

A single generic rule such as `count <= remaining_bytes` needs care: legal empty
or zero-size element types must not be rejected accidentally. Apply encoded-size
checks where justified by the type/schema, with a separate allocation budget for
other cases.

Regression cases should cover: truncated sequences with large accepted prefixes;
ordinary empty/small sequences; POD and non-POD generated messages; dynamic
sequences; nested sequences; and resource-limit failures returning errors rather
than panicking or aborting. Test on both native and wasm32 builds.

## Prior reports

Limited issue searches for `CDR allocation` and `bounded sequence` found no matching
report; they returned #197 (publish-size estimates) and #241 (service reply
correlation), which describe different problems. This is not an exhaustive issue
history audit. The earlier discovery/QoS report in the frost-res-groundstation
workspace remains separate from this finding.
