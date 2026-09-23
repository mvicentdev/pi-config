# pi-config

Configuración de [pi](https://pi.dev) a nivel de usuario, lista para replicarse en cualquier máquina.

```bash
curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
```

El script instala pi si falta (requiere Node.js 22.19+, npm y git), copia `agent/` en `~/.pi/agent`
(o `$PI_CODING_AGENT_DIR`) guardando como `<fichero>.bak-<fecha>` lo que ya existiera y fuese distinto,
e instala los paquetes de `settings.json` con `pi update --extensions`. Después, `/login` dentro de pi.
Volver a ejecutarlo es seguro.

| Ruta | Contenido |
|---|---|
| `agent/AGENTS.md` | Instrucciones globales del agente |
| `agent/settings.json` | Paquetes, tema, modelo por defecto y preferencias |
| `agent/models.json` | Ventana de contexto de los modelos de Anthropic |
| `agent/status-line.json` | Segmentos y paleta de la barra de estado |
| `agent/pi-fff.json`, `agent/subagents.json` | Ajustes de pi-fff y pi-subagents |
| `agent/themes/` | Tema generado por la barra de estado (Night Owl, acento magenta) |
| `extensions/status-line/` | Extensión propia de barra de estado (`/statusline`) |
| `extensions/max-width/` | Ancho máximo de pi en columnas, con el contenido centrado: `/max-width 120`, `/max-width off`; se guarda en `~/.pi/agent/max-width.json` |

El repositorio es en sí el paquete `git:github.com/mvicentdev/pi-config`, que carga `extensions/`.

Credenciales, sesiones y cachés no se versionan. Los cambios en `extensions/` llegan con `pi update`; los
de `agent/`, volviendo a ejecutar `install.sh`.
