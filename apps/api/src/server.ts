import { APP_NAME } from '@tozalist/shared'
import { buildApp } from './app.js'
import { readApiConfig } from './config.js'

const config = readApiConfig()
const app = buildApp({ logger: true })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`${APP_NAME} api listening on port ${config.port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
