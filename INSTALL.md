# Guía de instalación para agentes

Pasos que sigue un agente para instalar esta configuración de pi para un usuario, en cualquier
máquina. Qué contiene y qué queda como personal se explica en [README.md](README.md). Funciona en
macOS y en Linux; en Windows no, porque `install.sh` es de bash y usa enlaces simbólicos.

## Reglas

- Lo personal de `~/.pi/agent` no se sobrescribe ni se borra sin que el usuario lo apruebe:
  `auth.json`, `settings.json`, `models.json`, `APPEND_SYSTEM.md`, `status-line.json`,
  `max-width.json`, `autocorrect.json`, `trust.json`, sesiones y temas propios.
- `/login` y cualquier contraseña los hace el usuario en su terminal; el agente le da el comando exacto
  y espera.
- Nada se publica (commit o push) sin que el usuario haya visto el diff y dado el visto bueno.

## 1. Comprobar requisitos

```bash
node --version   # 22.19 o superior
npm --version
git --version
pi --version     # si falta, install.sh lo instala
```

Si falta Node.js, npm o git, se lo dices al usuario y te detienes: instalarlos depende de la máquina.

## 2. Revisar la configuración personal previa

Si el usuario ya usaba pi, revisa su `~/.pi/agent` antes de instalar, porque lo suyo tiene
preferencia sobre lo común:

- `pi list`: si ya aparece `git:github.com/mvicentdev/pi-config`, está instalada y el paso 3 la
  actualiza. Si aparece otra fuente que ya traiga este paquete, sea una ruta local a un clon o uno de
  los paquetes de las `dependencies` de [package.json](package.json), se cargaría dos veces: propón
  quitarla con `pi remove <fuente>`.
- Un `subagents.json`, `pi-fff.json` o `agents/` propios, que no sean enlaces, sustituyen a los comunes
  e `install.sh` los respeta. Si son copias antiguas sin cambios que el usuario quiera conservar,
  propón borrarlos.
- Un `subagent-models.json` propio solo debe llevar lo que cambia respecto de
  [subagent-models.json](subagent-models.json); si es idéntico, propón borrarlo.
- Un `AGENTS.md` propio pasa a `APPEND_SYSTEM.md`. Si ya existen los dos, `install.sh` se detiene:
  el usuario decide cómo unirlos.

## 3. Instalar o actualizar

```bash
curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
```

Se ejecuta con la cuenta del usuario que va a usar pi y no necesita `sudo`. Cada usuario de la máquina
lo ejecuta con la suya.

## 4. Verificar

```bash
pi list                                                 # incluye git:github.com/mvicentdev/pi-config
ls -la ~/.pi/agent/AGENTS.md                            # enlace a ~/.pi/agent/git/github.com/mvicentdev/pi-config/AGENTS.md
git -C ~/.pi/agent/git/github.com/mvicentdev/pi-config status -sb   # limpio y al día con origin/main
cd /tmp && pi -p --no-session "Responde solo: OK"
```

Si el último comando falla porque no hay credenciales, el usuario abre pi y hace `/login`. La
extensión `autocorrect` solo funciona en macOS y necesita la variable `TYPESAFE_API_KEY`; sin ella,
avisa de que está inactiva.

Informa de cada comprobación con su resultado y de lo que quede pendiente del usuario.

## Publicar cambios en la configuración común

El clon de `~/.pi/agent/git` es de pi: `pi update` lo reinicia y lo limpia, así que no se edita. Se
trabaja en un clon propio con la identidad de GitHub `mvicentdev`:

```bash
git clone https://github.com/mvicentdev/pi-config.git
cd pi-config
git config user.name mvicentdev
git config user.email 142339502+mvicentdev@users.noreply.github.com
./packages.sh install
```

Los paquetes se gestionan con `./packages.sh`, nunca con `npm` directamente. El título del commit
sigue Conventional Commits, y el push va a `main` después de que el usuario haya visto el diff y dado
el visto bueno. Cada usuario recibe el cambio con `pi update`.
