// Provenance marker for packaged builds. This is not a security boundary;
// it exists so distributed artifacts keep a lightweight origin trail.

export const ORCHESTRAI_FINGERPRINT = Object.freeze({
  project: 'OrchestrAI',
  author: 'samkj',
  publisher: 'samkj',
  repository: 'https://github.com/samkjsong-bot/OrchestrAI',
  provenance: 'original-work-samkj-orchestrai',
  notice: 'See NOTICE.md and LICENSE.',
})

export function formatOrchestraiFingerprint(): string {
  return [
    ORCHESTRAI_FINGERPRINT.project,
    ORCHESTRAI_FINGERPRINT.author,
    ORCHESTRAI_FINGERPRINT.repository,
    ORCHESTRAI_FINGERPRINT.provenance,
  ].join(' | ')
}
