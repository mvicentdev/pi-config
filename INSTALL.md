# Guía de instalación para agentes

Pasos que sigue un agente para instalar esta configuración de pi en cualquier máquina, o para conectar
a ella a un usuario más. Qué contiene y qué queda como personal se explica en [README.md](README.md).
Funciona en macOS y en Linux; en Windows no, porque los scripts son de shell y la ruta es
`/usr/local/share/pi/agent`.

## Reglas

- Lo personal de `~/.pi/agent` no se sobrescribe ni se borra sin que el usuario lo apruebe:
  `auth.json`, `settings.json`, `models.json`, `APPEND_SYSTEM.md`, `status-line.json`,
  `max-width.json`, `autocorrect.json`, `trust.json`, sesiones y temas propios.
- `sudo`, `/login` y cualquier contraseña los hace el usuario en su terminal; el agente le da el
  comando exacto y espera.
- Nada se publica (commit o push) sin que el usuario haya visto el diff y dado el visto bueno.

## 1. Comprobar requisitos

```bash
node --version   # 22.19 o superior
npm --version
git --version
pi --version     # si falta, install.sh lo instala
```

Si falta Node.js, npm o git, se lo dices al usuario y te detienes: instalarlos depende de la máquina.

## 2. Ver en qué estado está la máquina

```bash
ls -la /usr/local/share/pi/agent
git -C /usr/local/share/pi/agent remote -v
```

| Estado | Qué hacer |
|---|---|
| La carpeta no existe | Paso 3, instalación nueva |
| Es un clon de `github.com/mvicentdev/pi-config` | Ya está instalada: paso 3 para sincronizarla y conectar al usuario actual |
| Existe pero no es un clon de este repositorio | Detente y explícaselo al usuario: `install.sh` no la toca y hay que decidir qué hacer con lo que contiene |

## 3. Revisar la configuración personal previa

Si el usuario ya usaba pi, revisa su `~/.pi/agent` antes de instalar, porque lo suyo tiene
preferencia sobre lo común:

- `pi list`: los paquetes que ya trae la carpeta común (las `dependencies` de
  [package.json](package.json)) o `git:github.com/mvicentdev/pi-config` se cargarían dos veces. Propón
  quitarlos con `pi remove <fuente>`.
- Un `subagents.json`, `pi-fff.json` o `agents/` propios sustituyen a los comunes, y `link-user.sh` no
  los enlaza. Si son copias antiguas, sin cambios que el usuario quiera conservar, propón borrarlos.
- Un `subagent-models.json` propio solo debe llevar lo que cambia respecto de
  [subagent-models.json](subagent-models.json); si es idéntico, propón borrarlo.
- Un `AGENTS.md` propio pasa solo a `APPEND_SYSTEM.md`; no hace falta tocarlo.

## 4. Instalar o sincronizar

La primera instalación de la máquina pide `sudo` para crear la carpeta, así que la ejecuta el usuario:

```bash
curl -fsSL https://raw.githubusercontent.com/mvicentdev/pi-config/main/install.sh | bash
```

Si la carpeta ya existe, el agente puede ejecutar `/usr/local/share/pi/agent/install.sh` directamente.
Cada usuario de la máquina lo ejecuta una vez con su cuenta, y volver a ejecutarlo sincroniza.

La carpeta queda con el grupo principal de quien instala: en macOS es `staff`, común a todos los
usuarios. En Linux, si otros usuarios la van a usar, pide al usuario el grupo que comparten y dale este
comando: `sudo chgrp -R <grupo> /usr/local/share/pi/agent`.

## 5. Verificar

```bash
pi list                                    # incluye /usr/local/share/pi/agent
ls -la ~/.pi/agent/AGENTS.md               # enlace a /usr/local/share/pi/agent/AGENTS.md
git -C /usr/local/share/pi/agent status    # limpio y al día con origin/main
cd /tmp && pi -p --no-session "Responde solo: OK"
```

Si el último comando falla porque no hay credenciales, el usuario abre pi y hace `/login`. La
extensión `autocorrect` solo funciona en macOS y necesita la variable `TYPESAFE_API_KEY`; sin ella,
avisa de que está inactiva.

Informa de cada comprobación con su resultado y de lo que quede pendiente del usuario.

## Publicar cambios en la configuración común

Se edita en `/usr/local/share/pi/agent`, y los paquetes se gestionan con `packages.sh`, nunca con
`npm` directamente. Los commits de este repositorio van con la identidad de GitHub `mvicentdev`:

```bash
git -C /usr/local/share/pi/agent config user.name mvicentdev
git -C /usr/local/share/pi/agent config user.email 142339502+mvicentdev@users.noreply.github.com
```

El título sigue Conventional Commits, y el push va a `main` después de que el usuario haya visto el
diff y dado el visto bueno.
