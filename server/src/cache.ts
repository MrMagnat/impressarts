/**
 * Кэш ответов в памяти процесса.
 *
 * Данные склада меняются редко — раз в сутки при синхронизации с 1С либо по
 * кнопке. Между изменениями дашборд, каталог и отчёты считают одно и то же,
 * поэтому результат достаточно посчитать один раз.
 *
 * Инвалидация не по времени, а по версии данных: любая запись в базу поднимает
 * счётчик, и все накопленные ответы разом становятся недействительными. TTL
 * оставлен страховкой на случай, если какой-то путь записи забудут пометить.
 */

let version = 0;
let hits = 0;
let misses = 0;

const store = new Map<string, { version: number; at: number; value: unknown }>();

/** Пометить данные изменившимися — весь кэш становится недействительным. */
export function bumpDataVersion(): number {
  version++;
  store.clear();
  return version;
}

export function dataVersion(): number {
  return version;
}

/** Посчитать значение или отдать ранее посчитанное для той же версии данных. */
export function cached<T>(key: string, compute: () => T, ttlMs = 10 * 60_000): T {
  const hit = store.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < ttlMs) {
    hits++;
    return hit.value as T;
  }
  misses++;
  const value = compute();
  store.set(key, { version, at: Date.now(), value });
  return value;
}

export function cacheStats() {
  return { version, entries: store.size, hits, misses };
}
