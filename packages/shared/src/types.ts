import { INTERNAL_ONLY_SERVICES, SERVICE_NAMES } from './constants.js'

export type ServiceName = (typeof SERVICE_NAMES)[number]

export type InternalOnlyService = (typeof INTERNAL_ONLY_SERVICES)[number]

export type Environment = 'development' | 'test' | 'production'

/** Narrows an arbitrary string to a known service name. */
export function isServiceName(value: string): value is ServiceName {
  return (SERVICE_NAMES as readonly string[]).includes(value)
}

/** True when the service must stay inside the private network. */
export function isInternalOnlyService(value: ServiceName): value is InternalOnlyService {
  return (INTERNAL_ONLY_SERVICES as readonly string[]).includes(value)
}
