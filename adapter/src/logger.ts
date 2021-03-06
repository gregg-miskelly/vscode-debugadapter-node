/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import {OutputEvent} from './debugSession';

export enum LogLevel {
	Verbose = 0,
	Log = 1,
	Warn = 2,
	Error = 3,
	Stop = 4
}

export type ILogCallback = (outputEvent: OutputEvent) => void;

interface ILogItem {
	msg: string;
	level: LogLevel;
}

export interface ILogger {
	log(msg: string, level?: LogLevel): void;
	verbose(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

export class Logger {
	private _currentLogger: InternalLogger;
	private _pendingLogQ: ILogItem[] = [];

	log(msg: string, level = LogLevel.Log): void {
		msg = msg + '\n';
		this._write(msg, level);
	}

	verbose(msg: string): void {
		this.log(msg, LogLevel.Verbose);
	}

	warn(msg: string): void {
		this.log(msg, LogLevel.Warn);
	}

	error(msg: string): void {
		this.log(msg, LogLevel.Error);
	}

	/**
	 * `log` adds a newline, `write` doesn't
	 */
	private _write(msg: string, level = LogLevel.Log): void {
		// [null, undefined] => string
		msg = msg + '';
		if (this._pendingLogQ) {
			this._pendingLogQ.push({ msg, level });
		} else {
			this._currentLogger.log(msg, level);
		}
	}

	/**
	 * Set the logger's minimum level to log in the console, and whether to log to the file. Log messages are queued before this is
	 * called the first time, because minLogLevel defaults to Warn.
	 */
	setup(consoleMinLogLevel: LogLevel, logToFile: boolean): void {
		if (this._currentLogger) {
			this._currentLogger.setup(consoleMinLogLevel, logToFile);

			// Now that we have a minimum logLevel, we can clear out the queue of pending messages
			if (this._pendingLogQ) {
				const logQ = this._pendingLogQ;
				this._pendingLogQ = null;
				logQ.forEach(item => this._write(item.msg, item.level));
			}
		}
	}

	init(logCallback: ILogCallback, logFilePath?: string, logToConsole?: boolean): void {
		// Re-init, create new global Logger
		this._pendingLogQ = this._pendingLogQ || [];
		this._currentLogger = new InternalLogger(logCallback, logFilePath, logToConsole);
		if (logFilePath) {
			const d = new Date();
			const timestamp = d.toLocaleTimeString() + ', ' + d.toLocaleDateString();
			this.verbose(timestamp);
		}
	}
}

export const logger = new Logger();

/**
 * Manages logging, whether to console.log, file, or VS Code console.
 * Encapsulates the state specific to each logging session
 */
class InternalLogger {
	/** The path of the log file */
	private _logFilePath: string;

	private _minLogLevel: LogLevel;
	private _logToConsole: boolean;

	/** Log info that meets minLogLevel is sent to this callback. */
	private _logCallback: ILogCallback;

	/** Write steam for log file */
	private _logFileStream: fs.WriteStream;

	constructor(logCallback: ILogCallback, logFilePath?: string, isServer?: boolean) {
		this._logCallback = logCallback;
		this._logFilePath = logFilePath;
		this._logToConsole = isServer;

		this._minLogLevel = LogLevel.Warn;
	}

	public setup(consoleMinLogLevel: LogLevel, logToFile: boolean): void {
		this._minLogLevel = consoleMinLogLevel;

		// Open a log file in the specified location. Overwritten on each run.
		if (logToFile) {
			this.log(`Verbose logs are written to:\n`, LogLevel.Warn);
			this.log(this._logFilePath + '\n', LogLevel.Warn);

			this._logFileStream = fs.createWriteStream(this._logFilePath);
			this._logFileStream.on('error', e => {
				this.sendLog(`Error involving log file at path: ${this._logFilePath}. Error: ${e.toString()}`, LogLevel.Error);
			});
		}
	}

	public log(msg: string, level: LogLevel): void {

		if (this._minLogLevel === LogLevel.Stop) {
			return;
		}

		if (level >= this._minLogLevel) {
			this.sendLog(msg, level);
		}

		if (this._logToConsole) {
			const logFn =
				level === LogLevel.Error ? console.error :
				level === LogLevel.Warn ? console.warn :
				console.log;
			logFn(trimLastNewline(msg));
		}

		// If an error, prepend with '[Error]'
		if (level === LogLevel.Error) {
			msg = `[${LogLevel[level]}] ${msg}`;
		}

		if (this._logFileStream) {
			this._logFileStream.write(msg);
		}
	}

	private sendLog(msg: string, level: LogLevel): void {
		// Truncate long messages, they can hang VS Code
		if (msg.length > 1500) {
			const endsInNewline = !!msg.match(/(\n|\r\n)$/);
			msg = msg.substr(0, 1500) + '[...]';
			if (endsInNewline) {
				msg = msg + '\n';
			}
		}

		if (this._logCallback) {
			const event = new LogOutputEvent(msg, level);
			this._logCallback(event);
		}
	}
}

export class LogOutputEvent extends OutputEvent {
	constructor(msg: string, level: LogLevel) {
		const category =
			level === LogLevel.Error ? 'stderr' :
			level === LogLevel.Warn ? 'console' :
			'stdout';
		super(msg, category);
	}
}

export function trimLastNewline(str: string): string {
	return str.replace(/(\n|\r\n)$/, '');
}
