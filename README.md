# pi-config

Configuración común de [pi](https://pi.dev) para todos los usuarios de una máquina. Vive en
`/usr/local/share/pi/agent`, que es un clon de este repositorio: lo que un usuario cambia ahí lo ven
los demás al instante, y git la mantiene sincronizada con GitHub.

```bash
curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
```

El script instala pi si falta (requiere Node.js 22.19+, npm y git), clona el repositorio en
`/usr/local/share/pi/agent` si aún no está (pide `sudo` solo para crear la carpeta), conecta al usuario
actual con `link-user.sh`, trae los cambios de GitHub e instala los paquetes. Después, `/login` dentro
de pi. Cada usuario de la máquina lo ejecuta una vez; volver a ejecutarlo es seguro y sincroniza.

Un agente que instale esta configuración sigue [INSTALL.md](INSTALL.md).

## Qué es común y qué es de cada usuario

`link-user.sh` enlaza en `~/.pi/agent` (o `$PI_CODING_AGENT_DIR`) `AGENTS.md`, y también
`subagents.json`, `pi-fff.json` y `agents/` salvo que el usuario ya tenga los suyos, e instala la
carpeta como paquete local de pi. Un `AGENTS.md` personal previo pasa a `APPEND_SYSTEM.md`.

| Ruta | Contenido |
|---|---|
| `AGENTS.md` | Instrucciones globales del agente |
| `agents/` | Subagentes `explorer`, `researcher` y `worker` |
| `subagents.json`, `pi-fff.json` | Ajustes de pi-subagents y pi-fff |
| `subagent-models.json` | Modelo y razonamiento de cada subagente por proveedor |
| `extensions/` | `status-line` (`/statusline`), `max-width` (`/max-width 120`), `autocorrect` (`/autocorrect`, requiere `TYPESAFE_API_KEY`) y `subagent-models` |
| `package.json` | Paquetes de terceros que carga pi; `patches/` los corrige tras instalarlos |

Siguen siendo de cada usuario, en su `~/.pi/agent` y fuera de este repositorio: credenciales
(`auth.json`), `settings.json` (tema, modelo por defecto, paquetes propios), `models.json`,
`APPEND_SYSTEM.md` con sus instrucciones, y lo que guardan las extensiones: `status-line.json`,
`max-width.json`, `autocorrect.json`. Un `subagent-models.json` propio lleva solo las entradas que
cambian respecto del común.

## Cambiar la configuración común

Se edita en `/usr/local/share/pi/agent` y se publica con `git commit` y `git push` desde ahí. Los
paquetes se gestionan con `packages.sh`, que ejecuta npm en la carpeta y regenera el manifiesto `pi`
de `package.json`:

```bash
/usr/local/share/pi/agent/packages.sh install pi-btw
```

Para traer lo publicado desde otra máquina, `install.sh` de nuevo, o
`git -C /usr/local/share/pi/agent pull && /usr/local/share/pi/agent/packages.sh install`.
