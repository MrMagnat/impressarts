/** Render an HTML string to a PDF Buffer via Puppeteer (lazy-loaded, optional dependency). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  let puppeteer: any;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    throw new PdfUnavailable();
  }
  let browser: any;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (e) {
    throw new PdfUnavailable((e as Error).message);
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export class PdfUnavailable extends Error {
  constructor(detail?: string) {
    super(
      "Генерация PDF недоступна: не установлен Chromium (puppeteer). " +
        "Отчёт доступен в интерфейсе и для печати из браузера. " +
        (detail ?? ""),
    );
    this.name = "PdfUnavailable";
  }
}
