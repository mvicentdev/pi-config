# Aliases personales

`~/.zshrc` contiene credenciales. No leas el fichero entero y no ejecutes `zsh -i`, `source ~/.zshrc`, `env`, `printenv` ni `set`. Para ejecutar un alias, lee solo su línea con `grep -m1 "^alias <alias>=" ~/.zshrc ~/.zsh_aliases` y ejecuta el comando que define. `dps`, `dsh` y `dlog` son funciones de `~/.docker-tools.zsh`, que no contiene credenciales.

## Libre: solo lee, ejecútalo sin preguntar

| Alias | Descripción |
|---|---|
| `ll` | Lista el directorio con ocultos |
| `dds` | Diff del índice contra HEAD |
| `ddb` | Diff de la rama contra develop |
| `dps [-a] [-A]` | Contenedores del repo; `-a` parados, `-A` todos |
| `dlog [n\|patrón]` | Logs de un contenedor; sin `-f` |

## Confirmar: cambia estado, pide permiso antes

| Alias | Descripción |
|---|---|
| `gp` | Trae la rama remota |
| `dsh [n\|patrón] [cmd]` | Ejecuta un comando en un contenedor; `dbash` igual |
| `aa <alias> <cmd>` | Guarda un alias en `~/.zsh_aliases` |
| `aa- <alias>` | Borra un alias de `~/.zsh_aliases` |

## Nunca: solo nómbralo al usuario

| Alias | Descripción |
|---|---|
| `wt` | Elige un worktree y entra en él |
| `review` | Revisa el diff con lumen |
| `cc` | Claude Code sin permisos |
| `ca` | Cursor Agent sin confirmaciones |
| `apagar [HH:MM]` | Programa el apagado; `-c` cancela, `-l` lista |
