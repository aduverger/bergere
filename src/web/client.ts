import {
  decodeServer,
  type Command,
  type ServerMessage,
} from "../shared/protocol";
export class Connection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private selected = "";
  constructor(
    private receive: (message: ServerMessage) => void,
    private status: (connected: boolean) => void,
  ) {}
  start() {
    this.stopped = false;
    this.connect();
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
  }
  private wake = () => {
    if (document.visibilityState === "hidden") return;
    this.socket?.close();
    this.connect();
  };
  private connect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const old = this.socket;
    this.socket = undefined;
    old?.close();
    this.status(false);
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.status(true);
      this.subscribe(this.selected);
    };
    socket.onmessage = (e) => {
      if (this.socket !== socket) return;
      try {
        this.receive(decodeServer(JSON.parse(e.data)));
      } catch {
        socket.close(1008, "Invalid response");
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.status(false);
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 1000);
    };
    socket.onerror = () => socket.close();
  }
  subscribe(paneId: string) {
    this.selected = paneId;
    if (paneId && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({ type: "subscribe", version: 1, paneId }),
      );
  }
  send(command: Command) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("Disconnected. Message not sent.");
    this.socket.send(JSON.stringify(command));
  }
}
