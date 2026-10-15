/// <reference types='audioworklet' />
import registerAudioWorkletProcessor from './registerAudioWorkletProcessor';
import { rewriteEventData } from './ISequencerEventData';
import Synthesizer from './Synthesizer';
import { disableLogging, restoreLogging } from './logging';
const JSSynthObject = {
    rewriteEventData: rewriteEventData,
    Synthesizer: Synthesizer,
    disableLogging: disableLogging,
    restoreLogging: restoreLogging,
};
if (typeof globalThis !== 'undefined') {
    globalThis.JSSynth = JSSynthObject;
}
AudioWorkletGlobalScope.JSSynth = JSSynthObject;
// deprecated
AudioWorkletGlobalScope.Fluid = JSSynthObject;
registerAudioWorkletProcessor();
//# sourceMappingURL=workletEntry.js.map