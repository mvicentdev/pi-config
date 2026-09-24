#!/bin/sh
# Conecta el ~/.pi/agent del usuario actual con el conocimiento compartido de pi:
# enlaza AGENTS.md, subagents.json, pi-fff.json y agents/, e instala esta carpeta como paquete local
# (extensions, skills, prompts, themes). Credenciales, proveedores, modelos y
# preferencias siguen siendo de cada usuario; las instrucciones personales van
# en APPEND_SYSTEM.md, y los modelos de subagente que cambien respecto de la base
# común, en un subagent-models.json propio con solo esas entradas.
# La carpeta es un clon git de otro usuario: se marca como segura para que git opere en ella.
set -e
SHARED=/usr/local/share/pi/agent
AGENT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$AGENT"
git config --global --get-all safe.directory | grep -qxF "$SHARED" || git config --global --add safe.directory "$SHARED"
if [ -e "$AGENT/AGENTS.md" ] && [ ! -L "$AGENT/AGENTS.md" ]; then
  mv "$AGENT/AGENTS.md" "$AGENT/APPEND_SYSTEM.md"
  echo "Tu AGENTS.md personal pasa a $AGENT/APPEND_SYSTEM.md"
fi
ln -sfn "$SHARED/AGENTS.md" "$AGENT/AGENTS.md"
# Un subagents.json, pi-fff.json o agents/ propio del usuario tiene preferencia sobre el común.
[ -L "$AGENT/subagent-models.json" ] && rm "$AGENT/subagent-models.json"
for FILE in subagents.json pi-fff.json agents; do
  [ -e "$AGENT/$FILE" ] || ln -s "$SHARED/$FILE" "$AGENT/$FILE"
done
pi install "$SHARED"
