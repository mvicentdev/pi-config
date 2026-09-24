/**
 * Caché de prompt de 1 hora en lugar de 5 minutos: pi solo la pide con `PI_CACHE_RETENTION=long`, que
 * lee de `process.env` en cada petición. Retomar una sesión tras una pausa de más de 5 minutos lee el
 * contexto de la caché en vez de reescribirlo; a cambio, cada escritura cuesta 2× la entrada en lugar
 * de 1,25×. Quien exporte su propio `PI_CACHE_RETENTION` (por ejemplo `short`) lo conserva.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function cacheRetention(_pi: ExtensionAPI) {
	process.env.PI_CACHE_RETENTION ??= "long";
}
