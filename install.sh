#!/usr/bin/env bash
# Instala pi y copia esta configuración en ~/.pi/agent (o $PI_CODING_AGENT_DIR).
#   curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
# Los ficheros que ya existan y difieran se guardan como <fichero>.bak-<fecha> antes de
# sustituirlos. Credenciales (auth.json) y sesiones no se tocan: se inicia sesión con /login.
set -euo pipefail

REPO="${PI_CONFIG_REPO:-https://github.com/mvicentdev/pi-config.git}"
AGENT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
STAMP=$(date +%Y%m%d-%H%M%S)

command -v git >/dev/null || { echo "Falta git." >&2; exit 1; }

if ! command -v pi >/dev/null; then
  curl -fsSL https://pi.dev/install.sh | sh
  command -v pi >/dev/null || { echo "pi instalado, pero no está en el PATH: abre otra terminal y vuelve a ejecutar este script." >&2; exit 1; }
fi

# Desde un clon local se usa ese clon; con curl | bash se descarga el repositorio.
if [[ -f "${BASH_SOURCE[0]:-}" && -d "$(dirname "${BASH_SOURCE[0]}")/agent" ]]; then
  SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
else
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
  git clone --quiet --depth 1 "$REPO" "$SRC"
fi

cd "$SRC/agent"
find . -type f | while read -r file; do
  target="$AGENT/${file#./}"
  mkdir -p "$(dirname "$target")"
  if [[ -L "$target" ]] || { [[ -e "$target" ]] && ! cmp -s "$file" "$target"; }; then
    mv "$target" "$target.bak-$STAMP"
    echo "Copia de seguridad: $target.bak-$STAMP"
  fi
  cp "$file" "$target"
done

# Instala los paquetes declarados en settings.json.
pi update --extensions </dev/null
echo "Listo. Arranca pi y usa /login para autenticarte."
