// @internal
export let _module;
// @internal
export let _addFunction;
// @internal
export let _removeFunction;
// @internal
export let _fs;
let _addOnPostRunFn;
// @internal
export let fluid_settings_setint;
// @internal
export let fluid_settings_setnum;
// @internal
export let fluid_settings_setstr;
// @internal
export let fluid_synth_error;
// @internal
export let fluid_synth_sfload;
// @internal
export let fluid_sequencer_register_client;
// @internal
export let malloc;
// @internal
export let free;
// @internal
export let defaultMIDIEventCallback;
// @internal
export function bindFunctions(module) {
    if (module == null && fluid_synth_error) {
        // (already bound)
        return;
    }
    if (module != null) {
        if (!module.addFunction || !module.removeFunction || !module.addOnPostRun) {
            throw new Error("Invalid 'module' object. libfluidsynth-*.js (2.4.6 or higher) must be used.");
        }
        _module = module;
        _addFunction = _module.addFunction;
        _removeFunction = _module.removeFunction;
        _addOnPostRunFn = _module.addOnPostRun;
    }
    else if (typeof AudioWorkletGlobalScope !== "undefined") {
        _module = AudioWorkletGlobalScope.wasmModule;
        _addFunction = _module.addFunction || AudioWorkletGlobalScope.wasmAddFunction;
        _removeFunction = _module.removeFunction || AudioWorkletGlobalScope.wasmRemoveFunction;
        _addOnPostRunFn = _module.addOnPostRun || AudioWorkletGlobalScope.addOnPostRun;
    }
    else if (typeof Module !== "undefined") {
        _module = Module;
        if (_module.addFunction) {
            _addFunction = _module.addFunction;
            _removeFunction = _module.removeFunction;
        }
        else {
            _addFunction = addFunction;
            _removeFunction = removeFunction;
        }
        if (_module.addOnPostRun) {
            _addOnPostRunFn = _module.addOnPostRun;
        }
        else {
            _addOnPostRunFn = typeof addOnPostRun !== "undefined" ? addOnPostRun : undefined;
        }
    }
    else {
        throw new Error("wasm module is not available. libfluidsynth-*.js must be loaded.");
    }
    _fs = _module.FS;
    // wrapper to use String type
    fluid_settings_setint = _module.cwrap("fluid_settings_setint", "number", [
        "number",
        "string",
        "number",
    ]);
    fluid_settings_setnum = _module.cwrap("fluid_settings_setnum", "number", [
        "number",
        "string",
        "number",
    ]);
    fluid_settings_setstr = _module.cwrap("fluid_settings_setstr", "number", [
        "number",
        "string",
        "string",
    ]);
    fluid_synth_error = _module.cwrap("fluid_synth_error", "string", [
        "number",
    ]);
    fluid_synth_sfload = _module.cwrap("fluid_synth_sfload", "number", [
        "number",
        "string",
        "number",
    ]);
    fluid_sequencer_register_client = _module.cwrap("fluid_sequencer_register_client", "number", ["number", "string", "number", "number"]);
    malloc = _module._malloc.bind(_module);
    free = _module._free.bind(_module);
    defaultMIDIEventCallback =
        _module._fluid_synth_handle_midi_event.bind(_module);
}
let promiseWaitForInitialized;
// @internal
export function waitForInitialized() {
    if (promiseWaitForInitialized) {
        return promiseWaitForInitialized;
    }
    try {
        bindFunctions();
    }
    catch (e) {
        return Promise.reject(e);
    }
    if (_module.calledRun) {
        promiseWaitForInitialized = Promise.resolve();
        return promiseWaitForInitialized;
    }
    if (typeof _addOnPostRunFn === 'undefined') {
        promiseWaitForInitialized = new Promise((resolve) => {
            const fn = _module.onRuntimeInitialized;
            _module.onRuntimeInitialized = () => {
                resolve();
                if (fn) {
                    fn();
                }
            };
        });
    }
    else {
        promiseWaitForInitialized = new Promise((resolve) => {
            _addOnPostRunFn(resolve);
        });
    }
    return promiseWaitForInitialized;
}
//# sourceMappingURL=WasmManager.js.map