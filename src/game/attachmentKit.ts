/**
 * Lazy Skunkworks chunk: attachment state machines and their world effects. Loaded at boot when
 * the career has an attachment equipped, or the first time one is bought; stock runs never load it.
 */
export { createRig, pressAuxAbility, pressBladeAbility, rigReadout, stepRig, JATO_HIT_MUL, JATO_TIERS, JATO_TURN, RIPPER_TIERS } from '../vehicle/attachments';
export { fireHarpoon, stepAttachmentEffects } from '../sim/attachmentEffects';
