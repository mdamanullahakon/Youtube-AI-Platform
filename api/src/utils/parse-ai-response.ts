export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // continue to extraction strategies
  }

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      // continue to next strategy
    }
  }

  const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      // continue to next strategy
    }
  }

  const objectMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[1].trim());
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function extractJsonArray<T = unknown>(text: string): T[] | null {
  if (!text) return null;

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // continue to extraction strategies
  }

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
    } catch {
      // continue to next strategy
    }
  }

  const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
    } catch {
      // continue to next strategy
    }
  }

  const arrayMatch = trimmed.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function extractAndValidate<T>(
  text: string,
  validator: (data: unknown) => data is T
): T | null {
  if (!text) return null;

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (validator(parsed)) {
      return parsed;
    }
  } catch {
    // continue to extraction
  }

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (validator(parsed)) {
        return parsed;
      }
    } catch {
      // continue
    }
  }

  const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (validator(parsed)) {
        return parsed;
      }
    } catch {
      // continue
    }
  }

  const wrappedMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (wrappedMatch) {
    try {
      const parsed = JSON.parse(wrappedMatch[1].trim());
      if (validator(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function safeParseJson<T>(text: string, fallback: T): T {
  if (!text) return fallback;

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return parsed as T;
  } catch {
    // continue
  }

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      return parsed as T;
    } catch {
      // continue
    }
  }

  const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      return parsed as T;
    } catch {
      // continue
    }
  }

  const wrappedMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (wrappedMatch) {
    try {
      const parsed = JSON.parse(wrappedMatch[1].trim());
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  return fallback;
}
