// Caché de prompt de 1 hora en vez de 5 minutos. Pi la pide solo con `PI_CACHE_RETENTION=long`, leído de `process.env` en cada petición.
// Tras una pausa de más de 5 minutos se lee el contexto en vez de reescribirlo. Cada escritura cuesta 2× la entrada, no 1,25×.
// Un `PI_CACHE_RETENTION` propio (por ejemplo `short`) se respeta.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function cacheRetention(_pi: ExtensionAPI) {
	process.env.PI_CACHE_RETENTION ??= "long";
}
