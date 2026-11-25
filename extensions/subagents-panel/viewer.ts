import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ConversationViewer } from "../../vendor/pi-subagents/src/ui/conversation-viewer.ts";
import type { AgentRecord } from "../../vendor/pi-subagents/src/types.ts";

export const REPAINT_MS = 150;

/** Muestra el visor de pi-subagents en un overlay hasta que se cierra. `onOpen` recibe cómo cerrarlo desde fuera. */
export function showConversation(
	ui: ExtensionContext["ui"],
	events: ExtensionAPI["events"],
	agent: AgentRecord,
	session: NonNullable<AgentRecord["session"]>,
	onOpen: (close: () => void) => void,
): Promise<undefined> {
	return ui.custom<undefined>((viewerTui, theme, keybindings, done) => {
		let repaint: ReturnType<typeof setTimeout> | undefined;
		// El visor conserva su caché Markdown, así que agrupamos sus repintados de streaming.
		const batchedTui = new Proxy(viewerTui, {
			get(target, key) {
				if (key !== "requestRender") return Reflect.get(target, key);
				return () => { repaint ??= setTimeout(() => { repaint = undefined; viewerTui.requestRender(); }, REPAINT_MS); };
			},
		});
		onOpen(() => done(undefined));
		const viewer = new ConversationViewer(batchedTui, session, agent, undefined, theme, done,
			() => events.emit("subagents:rpc:stop", { requestId: `panel-${Date.now()}`, agentId: agent.id }),
			keybindings, (message) => void session.steer(message).catch((error) => ui.notify(String(error), "error")));
		return {
			render: (width) => viewer.render(width),
			invalidate: () => viewer.invalidate(),
			handleInput(data) { viewer.handleInput(data); viewerTui.requestRender(); },
			dispose() { if (repaint) clearTimeout(repaint); viewer.dispose(); },
		};
	}, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } });
}
