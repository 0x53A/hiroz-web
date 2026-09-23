// Dedicated timeout fixture: initialization never resolves and no Rust code runs.
self.wasm_bindgen = () => new Promise(() => {});
