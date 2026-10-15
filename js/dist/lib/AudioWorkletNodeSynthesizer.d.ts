import { InterpolationValues, PlayerSetTempoType } from './Constants';
import ISequencer from './ISequencer';
import ISynthesizer from './ISynthesizer';
import SynthesizerSettings from './SynthesizerSettings';
import WorkletSoundfont from './WorkletSoundfont';
/** An synthesizer object with AudioWorkletNode */
export default class AudioWorkletNodeSynthesizer implements ISynthesizer {
    constructor();
    /** Audio node for this synthesizer */
    get node(): AudioWorkletNode | null;
    /**
     * Create AudiWorkletNode instance
     */
    createAudioNode(context: AudioContext, settings?: SynthesizerSettings): AudioWorkletNode;
    isInitialized(): boolean;
    init(_sampleRate: number, _settings?: SynthesizerSettings): void;
    close(): void;
    isPlaying(): boolean;
    setInterpolation(value: InterpolationValues, channel?: number): void;
    getGain(): number;
    setGain(gain: number): void;
    setChannelType(channel: number, isDrum: boolean): void;
    waitForVoicesStopped(): Promise<void>;
    loadSFont(bin: ArrayBuffer): Promise<number>;
    unloadSFont(id: number): void;
    unloadSFontAsync(id: number): Promise<void>;
    /**
     * Returns the `Soundfont` instance for specified SoundFont.
     * @param sfontId loaded SoundFont id ({@link loadSFont} returns this)
     * @return resolve with `Soundfont` instance (rejected if `sfontId` is not valid or loaded)
     */
    getSFontObject(sfontId: number): Promise<WorkletSoundfont>;
    getSFontBankOffset(id: number): Promise<number>;
    setSFontBankOffset(id: number, offset: number): void;
    render(): void;
    midiNoteOn(chan: number, key: number, vel: number): void;
    midiNoteOff(chan: number, key: number): void;
    midiKeyPressure(chan: number, key: number, val: number): void;
    midiControl(chan: number, ctrl: number, val: number): void;
    midiProgramChange(chan: number, prognum: number): void;
    midiChannelPressure(chan: number, val: number): void;
    midiPitchBend(chan: number, val: number): void;
    midiSysEx(data: Uint8Array): void;
    midiPitchWheelSensitivity(chan: number, val: number): void;
    midiBankSelect(chan: number, bank: number): void;
    midiSFontSelect(chan: number, sfontId: number): void;
    midiProgramSelect(chan: number, sfontId: number, bank: number, presetNum: number): void;
    midiUnsetProgram(chan: number): void;
    midiProgramReset(): void;
    midiSystemReset(): void;
    midiAllNotesOff(chan?: number): void;
    midiAllSoundsOff(chan?: number): void;
    midiSetChannelType(chan: number, isDrum: boolean): void;
    resetPlayer(): Promise<void>;
    closePlayer(): void;
    isPlayerPlaying(): boolean;
    addSMFDataToPlayer(bin: ArrayBuffer): Promise<void>;
    playPlayer(): Promise<void>;
    stopPlayer(): void;
    retrievePlayerCurrentTick(): Promise<number>;
    retrievePlayerTotalTicks(): Promise<number>;
    retrievePlayerBpm(): Promise<number>;
    retrievePlayerMIDITempo(): Promise<number>;
    seekPlayer(ticks: number): void;
    setPlayerLoop(loopTimes: number): void;
    setPlayerTempo(tempoType: PlayerSetTempoType, tempo: number): void;
    waitForPlayerStopped(): Promise<void>;
    /**
     * Creates a sequencer instance associated with this worklet node.
     */
    createSequencer(): Promise<ISequencer>;
    /**
     * Hooks MIDI events sent by the player. The hook callback function defined on
     * AudioWorkletGlobalScope object available in the worklet is used.
     * @param callbackName hook callback function name available as 'AudioWorkletGlobalScope[callbackName]',
     *     or falsy value ('', null, or undefined) to unhook.
     *     The type of 'AudioWorkletGlobalScope[callbackName]' must be {@linkcode HookMIDIEventCallback}.
     * @param param any additional data passed to the callback.
     *     This data must be 'Transferable' data.
     *     Note that `param` will be transferred to the worklet immediately (once), not transferred at each events.
     * @param transfer optional objects (such as `MessagePort`) to transfer ownership to the worklet.
     *     The element should be included in `param` data (as `param` itself, a property of `param` object, or etc.).
     * @return Promise object that resolves when succeeded, or rejects when failed
     * @note In the callback, the first parameter `synthesizer` is an instance of {@linkcode Synthesizer}, not `AudioWorkletNodeSynthesizer`.
     *     This means that the synchronous methods such as `getPlayerCurrentTick` can be called.
     */
    hookPlayerMIDIEventsByName(callbackName: string | null | undefined, param?: any, transfer?: Transferable[]): Promise<void>;
    /**
     * Registers the user-defined client to the sequencer.
     * The client callback function defined on AudioWorkletGlobalScope
     * object available in the worklet is used.
     * The client can receive events in the time from sequencer process.
     * @param seq the sequencer instance created by {@linkcode AudioWorkletNodeSynthesizer.createSequencer}
     * @param clientName the client name
     * @param callbackName callback function name available as 'AudioWorkletGlobalScope[callbackName]',
     *     or falsy value ('', null, or undefined) to unhook.
     *     The type of 'AudioWorkletGlobalScope[callbackName]' must be {@linkcode SequencerClientCallback}.
     * @param param additional parameter passed to the callback
     * @return Promise object that resolves with registered client id when succeeded, or rejects when failed
     */
    registerSequencerClientByName(seq: ISequencer, clientName: string, callbackName: string, param: number): Promise<number>;
    /**
     * Call a function defined in the AudioWorklet.
     *
     * The function will receive two parameters; the first parameter is a {@linkcode Synthesizer} instance
     * (not `AudioWorkletNodeSynthesizer` instance), and the second is the data passed to 'param'.
     * This method is useful when the script loaded in AudioWorklet wants to
     * retrieve {@linkcode Synthesizer} instance.
     *
     * @param name a function name (must be retrieved from AudioWorkletGlobalScope[name])
     * @param param any parameter (must be Transferable)
     * @param transfer optional objects (such as `MessagePort`) to transfer ownership to the worklet.
     *     The element should be included in `param` data (as `param` itself, a property of `param` object, or etc.).
     * @return Promise object that resolves when the function process has done, or rejects when failed
     */
    callFunction(name: string, param: any, transfer?: Transferable[]): Promise<void>;
}
