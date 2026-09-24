#!/usr/bin/env bash
# Instala pi y la configuración común en /usr/local/share/pi/agent (un clon de este repositorio que
# comparten todos los usuarios de la máquina) y conecta con ella al usuario que lo ejecuta.
#   curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
# Volver a ejecutarlo sincroniza la carpeta con GitHub y reinstala sus paquetes. Lo personal de cada
# usuario en ~/.pi/agent no se toca: ver link-user.sh.
set -euo pipefail

REPO=https://github.com/mvicentdev/pi-config.git
SHARED=/usr/local/share/pi/agent
umask 002

command -v git >/dev/null || { echo "Falta git." >&2; exit 1; }
command -v npm >/dev/null || { echo "Falta npm." >&2; exit 1; }

if ! command -v pi >/dev/null; then
  curl -fsSL https://pi.dev/install.sh | sh
  command -v pi >/dev/null || { echo "pi instalado, pero no está en el PATH: abre otra terminal y vuelve a ejecutar este script." >&2; exit 1; }
fi

# La carpeta es del primer usuario que instala y de su grupo, con setgid para que lo creado dentro
# siga siendo del grupo y todos puedan editarla, sincronizarla y reinstalar sus paquetes.
if [[ ! -d "$SHARED/.git" ]]; then
  sudo mkdir -p "$SHARED"
  sudo chown "$(id -un):$(id -gn)" "$SHARED"
  sudo chmod 2775 "$SHARED"
  git clone --quiet --config core.sharedRepository=group "$REPO" "$SHARED"
fi

"$SHARED/link-user.sh"
git -C "$SHARED" pull --quiet --ff-only
"$SHARED/packages.sh" install
echo "Listo. Arranca pi y usa /login para autenticarte."
