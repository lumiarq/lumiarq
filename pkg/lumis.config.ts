import type { LumisConfig } from '@illumiarq/lumis'

const config: LumisConfig = {
  preferredRuntime: 'ollama',
  paths: {
    storage: 'src/storage',
  },
  supply: {
    allowedLicenses: ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'],
    maxVulnerabilities: 0,
    failOnSeverity: 'critical',
  },
  runtime: {
    policy: {
      commandAllowlist: ['pnpm *', 'node *', 'lumis *', 'npx *'],
      mode: 'strict',
    },
  },
}

export default config
