const MAX_LOGS = 600;
const logBuffer = [];

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function appendLog(level, chunk, encoding) {
  const text = typeof chunk === 'string' ? chunk : chunk.toString(encoding || 'utf8');
  const lines = text.split('\n');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  for (const line of lines) {
    if (!line.trim()) continue;

    // Detect level from content if standard stdout
    let detectedLevel = level;
    if (line.includes('ERROR') || line.includes('Error') || line.includes('Failed') || line.includes('Crash')) {
      detectedLevel = 'error';
    } else if (line.includes('WARN') || line.includes('Warning')) {
      detectedLevel = 'warn';
    } else if (line.includes('DEBUG')) {
      detectedLevel = 'debug';
    }

    logBuffer.push({
      time: now,
      level: detectedLevel,
      message: line,
    });

    if (logBuffer.length > MAX_LOGS) {
      logBuffer.shift();
    }
  }
}

// Intercept stdout
process.stdout.write = (chunk, encoding, cb) => {
  appendLog('info', chunk, encoding);
  return originalStdoutWrite(chunk, encoding, cb);
};

// Intercept stderr
process.stderr.write = (chunk, encoding, cb) => {
  appendLog('error', chunk, encoding);
  return originalStderrWrite(chunk, encoding, cb);
};

export function getRecentLogs() {
  return [...logBuffer];
}

export function clearLogs() {
  logBuffer.length = 0;
}
