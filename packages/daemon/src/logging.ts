import pino, { type LoggerOptions } from "pino";

export function createLogger(name = "daemon") {
  const options: LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? "info",
  };
  if (process.env.NODE_ENV !== "production") {
    options.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  return pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
