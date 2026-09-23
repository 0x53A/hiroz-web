use hiroz_cdr::{CdrDeserialize, CdrReader, LittleEndian};

fn main() {
    // Exactly the accepted cap, with no element bytes. This must return EOF,
    // not allocate 800 MB before it discovers the first element is missing.
    let bytes = 100_000_000u32.to_le_bytes();
    let mut reader = CdrReader::<LittleEndian>::new(&bytes);
    eprintln!("Decoding four bytes as Vec<u64> (run under a memory limit)");
    let result = Vec::<u64>::cdr_deserialize(&mut reader);
    eprintln!("result: {result:?}");
    assert!(result.is_err());
}
