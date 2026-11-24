/**
 * Caché de prompt de 1 hora en lugar de 5 minutos: pi solo la pide con `PI_CACHE_RETENTION=long`, que
 * lee de `process.env` en cada petición. Tras una pausa de más de 5 minutos se lee el contexto en
 * vez de reescribirlo. Cada escritura cuesta 2× la entrada en lugar de 1,25×. Un
 * `PI_CACHE_RETENTION` propio (por ejemplo `short`) se respeta.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function cacheRetention(_pi: ExtensionAPI) {
	process.env.PI_CACHE_RETENTION ??= "long";
}
