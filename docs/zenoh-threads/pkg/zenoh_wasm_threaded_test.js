let wasm_bindgen = (function(exports) {
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }

    /**
     * Initialize the threaded WASM runtime.
     *
     * Creates Web Workers for each ZRuntime variant, sharing the WASM module and
     * linear memory via SharedArrayBuffer.
     *
     * # Arguments
     * * `shim_url` — URL to the wasm-bindgen JS shim file (e.g., `"./pkg/my_crate.js"`).
     *   Workers will load this via `importScripts()`.
     *
     * # Returns
     * `true` if threaded mode was activated, `false` if falling back to single-threaded
     * (e.g., SharedArrayBuffer not available due to missing COOP/COEP headers).
     * @param {string} shim_url
     * @returns {boolean}
     */
    function __zenoh_init_threaded_runtime(shim_url) {
        const ptr0 = passStringToWasm0(shim_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.__zenoh_init_threaded_runtime(ptr0, len0);
        return ret !== 0;
    }
    exports.__zenoh_init_threaded_runtime = __zenoh_init_threaded_runtime;

    /**
     * Entry point called by each Web Worker after WASM module is initialized
     * with shared memory.
     *
     * Compute workers (Application, TX, RX, Net) run a pure-Rust [`LocalExecutor`]
     * that blocks the worker thread forever. Their futures are woken via
     * `Condvar::notify` (`memory.atomic.notify`), which works from any thread.
     * No JS is used on these workers after entry — `setTimeout`/`spawn_local`
     * would never fire since the event loop is permanently blocked.
     *
     * The Acceptor (I/O worker) keeps its JS event loop alive for WebSocket
     * callbacks. Its task drain uses setTimeout-based self-repolling, since
     * JS microtask wakers cannot be triggered reliably from other threads.
     * @param {number} variant_id
     */
    function __zenoh_worker_entry(variant_id) {
        wasm.__zenoh_worker_entry(variant_id);
    }
    exports.__zenoh_worker_entry = __zenoh_worker_entry;

    /**
     * Test entry point — called from the HTML page.
     * Initializes the threaded runtime and runs basic tests.
     * `endpoint` is the zenoh router endpoint for tests 5/6,
     * e.g. "ws/127.0.0.1:7448" or "wss/host:443".
     * @param {string} endpoint
     * @returns {Promise<void>}
     */
    function run_threaded_test(endpoint) {
        const ptr0 = passStringToWasm0(endpoint, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.run_threaded_test(ptr0, len0);
        return ret;
    }
    exports.run_threaded_test = run_threaded_test;

    function __wbg_get_imports(memory) {
        const import0 = {
            __proto__: null,
            __wbg___wbindgen_boolean_get_a86c216575a75c30: function(arg0) {
                const v = arg0;
                const ret = typeof(v) === 'boolean' ? v : undefined;
                return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
            },
            __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
                const ret = debugString(arg1);
                const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            },
            __wbg___wbindgen_is_function_49868bde5eb1e745: function(arg0) {
                const ret = typeof(arg0) === 'function';
                return ret;
            },
            __wbg___wbindgen_is_object_40c5a80572e8f9d3: function(arg0) {
                const val = arg0;
                const ret = typeof(val) === 'object' && val !== null;
                return ret;
            },
            __wbg___wbindgen_is_string_b29b5c5a8065ba1a: function(arg0) {
                const ret = typeof(arg0) === 'string';
                return ret;
            },
            __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
                const ret = arg0 === undefined;
                return ret;
            },
            __wbg___wbindgen_memory_73fdd881ebd2e7a3: function() {
                const ret = wasm.memory;
                return ret;
            },
            __wbg___wbindgen_module_7d79cdce5fe2ca41: function() {
                const ret = wasmModule;
                return ret;
            },
            __wbg___wbindgen_rethrow_828b2014a519945b: function(arg0) {
                throw arg0;
            },
            __wbg___wbindgen_string_get_914df97fcfa788f2: function(arg0, arg1) {
                const obj = arg1;
                const ret = typeof(obj) === 'string' ? obj : undefined;
                var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                var len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            },
            __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
                throw new Error(getStringFromWasm0(arg0, arg1));
            },
            __wbg__wbg_cb_unref_3c3b4f651835fbcb: function(arg0) {
                arg0._wbg_cb_unref();
            },
            __wbg_async_5727feb662848999: function(arg0) {
                const ret = arg0.async;
                return ret;
            },
            __wbg_buffer_445cfbc3a2377e52: function(arg0) {
                const ret = arg0.buffer;
                return ret;
            },
            __wbg_buffer_a77cc90da4bdb503: function(arg0) {
                const ret = arg0.buffer;
                return ret;
            },
            __wbg_call_d578befcc3145dee: function() { return handleError(function (arg0, arg1, arg2) {
                const ret = arg0.call(arg1, arg2);
                return ret;
            }, arguments); },
            __wbg_close_f181fdc02ee236e6: function() { return handleError(function (arg0) {
                arg0.close();
            }, arguments); },
            __wbg_createObjectURL_470fa06cc4a9e8f0: function() { return handleError(function (arg0, arg1) {
                const ret = URL.createObjectURL(arg1);
                const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            }, arguments); },
            __wbg_crypto_38df2bab126b63dc: function(arg0) {
                const ret = arg0.crypto;
                return ret;
            },
            __wbg_data_60b50110c5bd9349: function(arg0) {
                const ret = arg0.data;
                return ret;
            },
            __wbg_data_fb9bcfd0c825e8e0: function(arg0) {
                const ret = arg0.data;
                return ret;
            },
            __wbg_document_a28a21ae315de4ea: function(arg0) {
                const ret = arg0.document;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_error_38bec0a78dd8ded8: function(arg0) {
                console.error(arg0);
            },
            __wbg_eval_db8671e4e6469929: function() { return handleError(function (arg0, arg1) {
                const ret = eval(getStringFromWasm0(arg0, arg1));
                return ret;
            }, arguments); },
            __wbg_getElementById_1a2b69d69d3a074f: function(arg0, arg1, arg2) {
                const ret = arg0.getElementById(getStringFromWasm0(arg1, arg2));
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_getRandomValues_b2176991427f6db8: function() { return handleError(function (arg0) {
                globalThis.crypto.getRandomValues(arg0);
            }, arguments); },
            __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
                arg0.getRandomValues(arg1);
            }, arguments); },
            __wbg_innerHTML_0d187cc2b939f2c3: function(arg0, arg1) {
                const ret = arg1.innerHTML;
                const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            },
            __wbg_instanceof_ArrayBuffer_ff7c1337a5e3b33a: function(arg0) {
                let result;
                try {
                    result = arg0 instanceof ArrayBuffer;
                } catch (_) {
                    result = false;
                }
                const ret = result;
                return ret;
            },
            __wbg_instanceof_Window_c0fee4c064502536: function(arg0) {
                let result;
                try {
                    result = arg0 instanceof Window;
                } catch (_) {
                    result = false;
                }
                const ret = result;
                return ret;
            },
            __wbg_length_0c32cb8543c8e4c8: function(arg0) {
                const ret = arg0.length;
                return ret;
            },
            __wbg_log_0c201ade58bb55e1: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
                let deferred0_0;
                let deferred0_1;
                try {
                    deferred0_0 = arg0;
                    deferred0_1 = arg1;
                    console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
                } finally {
                    wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                }
            },
            __wbg_log_4c0baeb8af2f8f89: function(arg0) {
                console.log(arg0);
            },
            __wbg_log_ce2c4456b290c5e7: function(arg0, arg1) {
                let deferred0_0;
                let deferred0_1;
                try {
                    deferred0_0 = arg0;
                    deferred0_1 = arg1;
                    console.log(getStringFromWasm0(arg0, arg1));
                } finally {
                    wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                }
            },
            __wbg_mark_b4d943f3bc2d2404: function(arg0, arg1) {
                performance.mark(getStringFromWasm0(arg0, arg1));
            },
            __wbg_measure_84362959e621a2c1: function() { return handleError(function (arg0, arg1, arg2, arg3) {
                let deferred0_0;
                let deferred0_1;
                let deferred1_0;
                let deferred1_1;
                try {
                    deferred0_0 = arg0;
                    deferred0_1 = arg1;
                    deferred1_0 = arg2;
                    deferred1_1 = arg3;
                    performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
                } finally {
                    wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
                }
            }, arguments); },
            __wbg_message_fdb8e0026739d05d: function(arg0, arg1) {
                const ret = arg1.message;
                const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            },
            __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
                const ret = arg0.msCrypto;
                return ret;
            },
            __wbg_new_40792555590ec35c: function(arg0, arg1) {
                try {
                    var state0 = {a: arg0, b: arg1};
                    var cb0 = (arg0, arg1) => {
                        const a = state0.a;
                        state0.a = 0;
                        try {
                            return wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                        } finally {
                            state0.a = a;
                        }
                    };
                    const ret = new Promise(cb0);
                    return ret;
                } finally {
                    state0.a = 0;
                }
            },
            __wbg_new_4f9fafbb3909af72: function() {
                const ret = new Object();
                return ret;
            },
            __wbg_new_753190ec436990fe: function(arg0) {
                const ret = new Int32Array(arg0);
                return ret;
            },
            __wbg_new_a2d8434834334bbf: function() { return handleError(function (arg0, arg1) {
                const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
                return ret;
            }, arguments); },
            __wbg_new_a560378ea1240b14: function(arg0) {
                const ret = new Uint8Array(arg0);
                return ret;
            },
            __wbg_new_abad7dc3813f957c: function() { return handleError(function (arg0, arg1) {
                const ret = new Worker(getStringFromWasm0(arg0, arg1));
                return ret;
            }, arguments); },
            __wbg_new_f3c9df4f38f3f798: function() {
                const ret = new Array();
                return ret;
            },
            __wbg_new_typed_14d7cc391ce53d2c: function(arg0, arg1) {
                try {
                    var state0 = {a: arg0, b: arg1};
                    var cb0 = (arg0, arg1) => {
                        const a = state0.a;
                        state0.a = 0;
                        try {
                            return wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                        } finally {
                            state0.a = a;
                        }
                    };
                    const ret = new Promise(cb0);
                    return ret;
                } finally {
                    state0.a = 0;
                }
            },
            __wbg_new_with_length_9cedd08484b73942: function(arg0) {
                const ret = new Uint8Array(arg0 >>> 0);
                return ret;
            },
            __wbg_new_with_str_sequence_and_options_490842bfc6cae3f2: function() { return handleError(function (arg0, arg1) {
                const ret = new Blob(arg0, arg1);
                return ret;
            }, arguments); },
            __wbg_new_worker_8edf8ebda6a768a7: function(arg0, arg1) {
                const ret = new Worker(getStringFromWasm0(arg0, arg1));
                return ret;
            },
            __wbg_node_84ea875411254db1: function(arg0) {
                const ret = arg0.node;
                return ret;
            },
            __wbg_now_cd1c76a02599db98: function() {
                const ret = Date.now();
                return ret;
            },
            __wbg_of_cc32e7afcce5ea8e: function(arg0) {
                const ret = Array.of(arg0);
                return ret;
            },
            __wbg_of_f30df5d78b1d5cf3: function(arg0, arg1, arg2) {
                const ret = Array.of(arg0, arg1, arg2);
                return ret;
            },
            __wbg_postMessage_6010c627e5408e23: function() { return handleError(function (arg0, arg1) {
                arg0.postMessage(arg1);
            }, arguments); },
            __wbg_postMessage_b2f3a9b43857bbfb: function() { return handleError(function (arg0, arg1) {
                arg0.postMessage(arg1);
            }, arguments); },
            __wbg_process_44c7a14e11e9f69e: function(arg0) {
                const ret = arg0.process;
                return ret;
            },
            __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
                Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
            },
            __wbg_push_6bdbc990be5ac37b: function(arg0, arg1) {
                const ret = arg0.push(arg1);
                return ret;
            },
            __wbg_queueMicrotask_abaf92f0bd4e80a4: function(arg0) {
                const ret = arg0.queueMicrotask;
                return ret;
            },
            __wbg_queueMicrotask_df5a6dac26d818f3: function(arg0) {
                queueMicrotask(arg0);
            },
            __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
                arg0.randomFillSync(arg1);
            }, arguments); },
            __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
                const ret = module.require;
                return ret;
            }, arguments); },
            __wbg_resolve_0a79de24e9d2267b: function(arg0) {
                const ret = Promise.resolve(arg0);
                return ret;
            },
            __wbg_revokeObjectURL_f164474640ca9d10: function() { return handleError(function (arg0, arg1) {
                URL.revokeObjectURL(getStringFromWasm0(arg0, arg1));
            }, arguments); },
            __wbg_send_ef0ff91d4523ddfd: function() { return handleError(function (arg0, arg1) {
                arg0.send(arg1);
            }, arguments); },
            __wbg_setTimeout_553bc247bec3e16e: function() { return handleError(function (arg0, arg1, arg2) {
                const ret = arg0.setTimeout(arg1, arg2);
                return ret;
            }, arguments); },
            __wbg_setTimeout_96139102d6cae6bf: function(arg0, arg1) {
                setTimeout(arg0, arg1);
            },
            __wbg_set_16a9c1a07b3d38ec: function(arg0, arg1, arg2) {
                arg0.set(getArrayU8FromWasm0(arg1, arg2));
            },
            __wbg_set_binaryType_95c0a0f7586a3903: function(arg0, arg1) {
                arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
            },
            __wbg_set_innerHTML_7e29b346becaeb8b: function(arg0, arg1, arg2) {
                arg0.innerHTML = getStringFromWasm0(arg1, arg2);
            },
            __wbg_set_onclose_47cce56c686db4fb: function(arg0, arg1) {
                arg0.onclose = arg1;
            },
            __wbg_set_onerror_3db8bc3e52b2b10b: function(arg0, arg1) {
                arg0.onerror = arg1;
            },
            __wbg_set_onmessage_45bd33b110c54f5b: function(arg0, arg1) {
                arg0.onmessage = arg1;
            },
            __wbg_set_onmessage_733b5167b7dd9b01: function(arg0, arg1) {
                arg0.onmessage = arg1;
            },
            __wbg_set_onopen_7ffeb01f8a628209: function(arg0, arg1) {
                arg0.onopen = arg1;
            },
            __wbg_set_type_ef754f25329c9096: function(arg0, arg1, arg2) {
                arg0.type = getStringFromWasm0(arg1, arg2);
            },
            __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: function() {
                const ret = typeof globalThis === 'undefined' ? null : globalThis;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: function() {
                const ret = typeof global === 'undefined' ? null : global;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_SELF_24f78b6d23f286ea: function() {
                const ret = typeof self === 'undefined' ? null : self;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_static_accessor_WINDOW_59fd959c540fe405: function() {
                const ret = typeof window === 'undefined' ? null : window;
                return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
            },
            __wbg_subarray_0f98d3fb634508ad: function(arg0, arg1, arg2) {
                const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
                return ret;
            },
            __wbg_then_00eed3ac0b8e82cb: function(arg0, arg1, arg2) {
                const ret = arg0.then(arg1, arg2);
                return ret;
            },
            __wbg_then_50c1ba21bde9ae37: function(arg0, arg1) {
                const ret = arg0.then(arg1);
                return ret;
            },
            __wbg_then_a0c8db0381c8994c: function(arg0, arg1) {
                const ret = arg0.then(arg1);
                return ret;
            },
            __wbg_value_b39d2197b4e92689: function(arg0) {
                const ret = arg0.value;
                return ret;
            },
            __wbg_versions_276b2795b1c6a219: function(arg0) {
                const ret = arg0.versions;
                return ret;
            },
            __wbg_waitAsync_85b896c39ac58fbb: function(arg0, arg1, arg2) {
                const ret = Atomics.waitAsync(arg0, arg1 >>> 0, arg2);
                return ret;
            },
            __wbg_waitAsync_f6bff47f206d803d: function() {
                const ret = Atomics.waitAsync;
                return ret;
            },
            __wbindgen_cast_0000000000000001: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3151, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue______true_);
                return ret;
            },
            __wbindgen_cast_0000000000000002: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3370, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue__core_132a09007f6e6bcf___result__Result_____wasm_bindgen_b731c4ceb865b2a___JsError___true_);
                return ret;
            },
            __wbindgen_cast_0000000000000003: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3392, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___futures__task__wait_async_polyfill__MessageEvent______true_);
                return ret;
            },
            __wbindgen_cast_0000000000000004: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ErrorEvent")], shim_idx: 2684, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true_);
                return ret;
            },
            __wbindgen_cast_0000000000000005: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 2684, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true__4);
                return ret;
            },
            __wbindgen_cast_0000000000000006: function(arg0, arg1) {
                // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3153, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
                const ret = makeMutClosure(arg0, arg1, wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke_______true_);
                return ret;
            },
            __wbindgen_cast_0000000000000007: function(arg0) {
                // Cast intrinsic for `F64 -> Externref`.
                const ret = arg0;
                return ret;
            },
            __wbindgen_cast_0000000000000008: function(arg0, arg1) {
                // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
                const ret = getArrayU8FromWasm0(arg0, arg1);
                return ret;
            },
            __wbindgen_cast_0000000000000009: function(arg0, arg1) {
                // Cast intrinsic for `Ref(String) -> Externref`.
                const ret = getStringFromWasm0(arg0, arg1);
                return ret;
            },
            __wbindgen_init_externref_table: function() {
                const table = wasm.__wbindgen_externrefs;
                const offset = table.grow(4);
                table.set(0, undefined);
                table.set(offset + 0, undefined);
                table.set(offset + 1, null);
                table.set(offset + 2, true);
                table.set(offset + 3, false);
            },
            __wbindgen_link_30693bc4809a2ef3: function(arg0) {
                const val = `onmessage = function (ev) {
                    let [ia, index, value] = ev.data;
                    ia = new Int32Array(ia.buffer);
                    let result = Atomics.wait(ia, index, value);
                    postMessage(result);
                };
                `;
                const ret = typeof URL.createObjectURL === 'undefined' ? "data:application/javascript," + encodeURIComponent(val) : URL.createObjectURL(new Blob([val], { type: "text/javascript" }));
                const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len1 = WASM_VECTOR_LEN;
                getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
                getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
            },
            memory: memory || new WebAssembly.Memory({initial:24,maximum:16384,shared:true}),
        };
        return {
            __proto__: null,
            "./zenoh_wasm_threaded_test_bg.js": import0,
        };
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke_______true_(arg0, arg1) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke_______true_(arg0, arg1);
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue______true_(arg0, arg1, arg2) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue______true_(arg0, arg1, arg2);
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___futures__task__wait_async_polyfill__MessageEvent______true_(arg0, arg1, arg2) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___futures__task__wait_async_polyfill__MessageEvent______true_(arg0, arg1, arg2);
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true_(arg0, arg1, arg2) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true_(arg0, arg1, arg2);
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true__4(arg0, arg1, arg2) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___web_sys_63b3c9b8ff9f7d85___features__gen_ErrorEvent__ErrorEvent______true__4(arg0, arg1, arg2);
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue__core_132a09007f6e6bcf___result__Result_____wasm_bindgen_b731c4ceb865b2a___JsError___true_(arg0, arg1, arg2) {
        const ret = wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___wasm_bindgen_b731c4ceb865b2a___JsValue__core_132a09007f6e6bcf___result__Result_____wasm_bindgen_b731c4ceb865b2a___JsError___true_(arg0, arg1, arg2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }

    function wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
        wasm.wasm_bindgen_b731c4ceb865b2a___convert__closures_____invoke___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined___js_sys_62acf05213da2dd___Function_fn_wasm_bindgen_b731c4ceb865b2a___JsValue_____wasm_bindgen_b731c4ceb865b2a___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
    }


    const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];

    function addToExternrefTable0(obj) {
        const idx = wasm.__externref_table_alloc();
        wasm.__wbindgen_externrefs.set(idx, obj);
        return idx;
    }

    const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

    function debugString(val) {
        // primitive types
        const type = typeof val;
        if (type == 'number' || type == 'boolean' || val == null) {
            return  `${val}`;
        }
        if (type == 'string') {
            return `"${val}"`;
        }
        if (type == 'symbol') {
            const description = val.description;
            if (description == null) {
                return 'Symbol';
            } else {
                return `Symbol(${description})`;
            }
        }
        if (type == 'function') {
            const name = val.name;
            if (typeof name == 'string' && name.length > 0) {
                return `Function(${name})`;
            } else {
                return 'Function';
            }
        }
        // objects
        if (Array.isArray(val)) {
            const length = val.length;
            let debug = '[';
            if (length > 0) {
                debug += debugString(val[0]);
            }
            for(let i = 1; i < length; i++) {
                debug += ', ' + debugString(val[i]);
            }
            debug += ']';
            return debug;
        }
        // Test for built-in
        const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
        let className;
        if (builtInMatches && builtInMatches.length > 1) {
            className = builtInMatches[1];
        } else {
            // Failed to match the standard '[object ClassName]'
            return toString.call(val);
        }
        if (className == 'Object') {
            // we're a user defined class or Object
            // JSON.stringify avoids problems with cycles, and is generally much
            // easier than looping through ownProperties of `val`.
            try {
                return 'Object(' + JSON.stringify(val) + ')';
            } catch (_) {
                return 'Object';
            }
        }
        // errors
        if (val instanceof Error) {
            return `${val.name}: ${val.message}\n${val.stack}`;
        }
        // TODO we could test for more things here, like `Set`s and `Map`s.
        return className;
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }

    let cachedDataViewMemory0 = null;
    function getDataViewMemory0() {
        if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
            cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
        }
        return cachedDataViewMemory0;
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return decodeText(ptr, len);
    }

    let cachedUint8ArrayMemory0 = null;
    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function handleError(f, args) {
        try {
            return f.apply(this, args);
        } catch (e) {
            const idx = addToExternrefTable0(e);
            wasm.__wbindgen_exn_store(idx);
        }
    }

    function isLikeNone(x) {
        return x === undefined || x === null;
    }

    function makeMutClosure(arg0, arg1, f) {
        const state = { a: arg0, b: arg1, cnt: 1 };
        const real = (...args) => {

            // First up with a closure we increment the internal reference
            // count. This ensures that the Rust closure environment won't
            // be deallocated while we're invoking it.
            state.cnt++;
            const a = state.a;
            state.a = 0;
            try {
                return f(a, state.b, ...args);
            } finally {
                state.a = a;
                real._wbg_cb_unref();
            }
        };
        real._wbg_cb_unref = () => {
            if (--state.cnt === 0) {
                wasm.__wbindgen_destroy_closure(state.a, state.b);
                state.a = 0;
                CLOSURE_DTORS.unregister(state);
            }
        };
        CLOSURE_DTORS.register(real, state, state);
        return real;
    }

    function passStringToWasm0(arg, malloc, realloc) {
        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = getUint8ArrayMemory0();

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }
        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
            const ret = cachedTextEncoder.encodeInto(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_externrefs.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : undefined);
    if (cachedTextDecoder) cachedTextDecoder.decode();

    function decodeText(ptr, len) {
        return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
    }

    const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined);

    if (cachedTextEncoder) {
        cachedTextEncoder.encodeInto = function (arg, view) {
            const buf = cachedTextEncoder.encode(arg);
            view.set(buf);
            return {
                read: arg.length,
                written: buf.length
            };
        };
    }

    let WASM_VECTOR_LEN = 0;

    let wasmModule, wasm;
    function __wbg_finalize_init(instance, module, thread_stack_size) {
        wasm = instance.exports;
        wasmModule = module;
        cachedDataViewMemory0 = null;
        cachedUint8ArrayMemory0 = null;
        if (typeof thread_stack_size !== 'undefined' && (typeof thread_stack_size !== 'number' || thread_stack_size === 0 || thread_stack_size % 65536 !== 0)) {
            throw new Error('invalid stack size');
        }

        wasm.__wbindgen_start(thread_stack_size);
        return wasm;
    }

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);
                } catch (e) {
                    const validResponse = module.ok && expectedResponseType(module.type);

                    if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else { throw e; }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);
        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };
            } else {
                return instance;
            }
        }

        function expectedResponseType(type) {
            switch (type) {
                case 'basic': case 'cors': case 'default': return true;
            }
            return false;
        }
    }

    function initSync(module, memory) {
        if (wasm !== undefined) return wasm;

        let thread_stack_size
        if (module !== undefined) {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module, memory, thread_stack_size} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports(memory);
        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }
        const instance = new WebAssembly.Instance(module, imports);
        return __wbg_finalize_init(instance, module, thread_stack_size);
    }

    async function __wbg_init(module_or_path, memory) {
        if (wasm !== undefined) return wasm;

        let thread_stack_size
        if (module_or_path !== undefined) {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path, memory, thread_stack_size} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (module_or_path === undefined && script_src !== undefined) {
            module_or_path = script_src.replace(/\.js$/, "_bg.wasm");
        }
        const imports = __wbg_get_imports(memory);

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module, thread_stack_size);
    }

    return Object.assign(__wbg_init, { initSync }, exports);
})({ __proto__: null });
