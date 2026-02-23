import path from "node:path";
import { getProjectRoot } from "./constants";

const HELP_TEXT = `Usage: inference-server-manager [command]

Commands:
  (no command)   Start the inference server (default)
  install        Compile binary and install systemd user service
  uninstall      Remove systemd user service
  update         Recompile binary and restart service
  status         Show service status

Options:
  --help, -h     Show this help message
  --version, -v  Show version`;

export async function runCli(command: string, args: string[]): Promise<void> {
	switch (command) {
		case "install": {
			const { install } = await import("./install");
			return install(args);
		}
		case "uninstall": {
			const { uninstall } = await import("./uninstall");
			return uninstall(args);
		}
		case "update": {
			const { update } = await import("./update");
			return update(args);
		}
		case "status": {
			const { status } = await import("./status");
			return status(args);
		}
		case "--help":
		case "-h": {
			console.log(HELP_TEXT);
			return;
		}
		case "--version":
		case "-v": {
			const pkgPath = path.join(getProjectRoot(), "package.json");
			const pkg = await Bun.file(pkgPath).json();
			console.log(pkg.version);
			return;
		}
		default: {
			console.error(`Unknown command: ${command}`);
			console.error(HELP_TEXT);
			process.exit(1);
		}
	}
}
