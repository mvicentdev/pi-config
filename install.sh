#!/usr/bin/env bash
# Instala pi y esta configuración común para el usuario que lo ejecuta: pi clona el repositorio como
# paquete en ~/.pi/agent/git (o $PI_CODING_AGENT_DIR/git) e instala sus dependencias, y este script
# enlaza en ~/.pi/agent los ficheros comunes que pi solo lee de ahí.
#   curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
# Volver a ejecutarlo trae la última versión. Credenciales, proveedores, modelos y preferencias siguen
# siendo de cada usuario; las instrucciones personales van en APPEND_SYSTEM.md, y los modelos de
# subagente que cambien respecto de los comunes, en un subagent-models.json propio con solo esas entradas.
set -euo pipefail

SOURCE=git:github.com/mvicentdev/pi-config
AGENT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PACKAGE="$AGENT/git/github.com/mvicentdev/pi-config"

command -v git >/dev/null || { echo "Falta git." >&2; exit 1; }
command -v npm >/dev/null || { echo "Falta npm." >&2; exit 1; }

if ! command -v pi >/dev/null; then
  curl -fsSL https://pi.dev/install.sh | sh
  command -v pi >/dev/null || { echo "pi instalado, pero no está en el PATH: abre otra terminal y vuelve a ejecutar este script." >&2; exit 1; }
fi

pi install "$SOURCE" </dev/null

if [[ -e "$AGENT/AGENTS.md" && ! -L "$AGENT/AGENTS.md" ]]; then
  [[ -e "$AGENT/APPEND_SYSTEM.md" ]] && { echo "Tienes AGENTS.md y APPEND_SYSTEM.md propios: une tus instrucciones en APPEND_SYSTEM.md, borra AGENTS.md y vuelve a ejecutar este script." >&2; exit 1; }
  mv "$AGENT/AGENTS.md" "$AGENT/APPEND_SYSTEM.md"
  echo "Tu AGENTS.md personal pasa a $AGENT/APPEND_SYSTEM.md"
fi
ln -sfn "$PACKAGE/AGENTS.md" "$AGENT/AGENTS.md"

# Un subagents.json, pi-fff.json o agents/ propio, que no sea un enlace, tiene preferencia sobre el común.
for file in subagents.json pi-fff.json agents; do
  if [[ -L "$AGENT/$file" || ! -e "$AGENT/$file" ]]; then
    ln -sfn "$PACKAGE/$file" "$AGENT/$file"
  fi
done

echo "Listo. Arranca pi y usa /login para autenticarte."
