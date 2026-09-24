# pi-config

Configuración común de [pi](https://pi.dev) para todos sus usuarios, en cualquier máquina. Cada usuario
la instala como paquete de pi desde este repositorio y conserva en su `~/.pi/agent` lo que es suyo.

```bash
curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
```

El script instala pi si falta (requiere Node.js 22.19+, npm y git) y ejecuta
`pi install git:github.com/mvicentdev/pi-config`. pi clona así el repositorio en
`~/.pi/agent/git/github.com/mvicentdev/pi-config` e instala sus dependencias, y el script enlaza desde
`~/.pi/agent` los ficheros comunes que pi solo lee de ahí. Después, `/login` dentro de pi. Cada usuario
lo ejecuta con su cuenta. `pi update` trae la última versión publicada, y volver a ejecutar el script
también rehace los enlaces.

Un agente que instale esta configuración sigue [INSTALL.md](INSTALL.md).

## Qué es común y qué es de cada usuario

El paquete carga `extensions/`, `skills/`, `prompts/`, `themes/` y los recursos de sus dependencias.
`install.sh` enlaza además `AGENTS.md` en `~/.pi/agent` (o `$PI_CODING_AGENT_DIR`), y también
`subagents.json`, `pi-fff.json` y `agents/` salvo que el usuario tenga los suyos. Un `AGENTS.md`
personal previo pasa a `APPEND_SYSTEM.md`.

| Ruta | Contenido |
|---|---|
| `AGENTS.md` | Instrucciones globales del agente |
| `agents/` | Subagentes `explorer`, `researcher` y `worker` |
| `subagents.json`, `pi-fff.json` | Ajustes de pi-subagents y pi-fff |
| `subagent-models.json` | Modelo y razonamiento de cada subagente por proveedor |
| `extensions/` | `status-line` (`/statusline`), `max-width` (`/max-width 120`), `autocorrect` (`/autocorrect`, solo macOS, requiere `TYPESAFE_API_KEY`) y `subagent-models` |
| `package.json` | Paquetes de terceros que carga pi; `patches/` los corrige tras instalarlos y `.npmrc` fija las opciones de npm |

Siguen siendo de cada usuario, en su `~/.pi/agent` y fuera de este repositorio: credenciales
(`auth.json`), `settings.json` (tema, modelo y razonamiento por defecto, paquetes propios),
`models.json`, `APPEND_SYSTEM.md` con sus instrucciones, y lo que guardan las extensiones:
`status-line.json`, `max-width.json`, `autocorrect.json`. Un `subagent-models.json` propio lleva solo
las entradas que cambian respecto del común.

## Cambiar la configuración común

El clon que gestiona pi no se edita: `pi update` lo reinicia y lo limpia. Se trabaja en un clon propio,
se publica con `git commit` y `git push`, y cada usuario lo recibe con `pi update`. Los paquetes se
gestionan con `packages.sh`, que ejecuta npm en el clon y regenera el manifiesto `pi` de
`package.json`:

```bash
./packages.sh install pi-btw
```
