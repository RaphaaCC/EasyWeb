const MAX_FIELD_LENGTH = 180;

function compact(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function redactText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[dado removido]")
    .replace(/(?:\d[ -]?){13,19}/g, "[dado removido]")
    .replace(/\b\d{3}[.-]?\d{3}[.-]?\d{3}[.-]?\d{2}\b/g, "[dado removido]")
    .slice(0, MAX_FIELD_LENGTH);
}

function quote(value) {
  return /\s|["=]/.test(value) ? JSON.stringify(value) : value;
}

function formatFields(fields) {
  if (!fields || typeof fields !== "object") return "";
  return Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined || value === null || value === "") return [];
    const sensitive = /(?:secret|token|password|authorization|snapshot|html|css|payload)/i.test(key);
    const normalized = sensitive ? "[oculto]" : redactText(value);
    return normalized ? [`${key}=${quote(normalized)}`] : [];
  }).join(" ");
}

export function createApiLogger({ output = console } = {}) {
  function write(level, event, fields) {
    const formattedFields = formatFields(fields);
    const message = `[easyweb] ${compact(event)}${formattedFields ? ` ${formattedFields}` : ""}`;
    const target = typeof output?.[level] === "function" ? output[level] : output?.log;
    target?.call(output, message);
  }

  return Object.freeze({
    info(event, fields) {
      write("info", event, fields);
    },
    warn(event, fields) {
      write("warn", event, fields);
    },
    error(event, fields) {
      write("error", event, fields);
    }
  });
}
