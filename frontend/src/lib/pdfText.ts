import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let isWorkerConfigured = false

function ensurePdfWorkerConfigured() {
  if (isWorkerConfigured) {
    return
  }
  GlobalWorkerOptions.workerSrc = pdfWorker
  isWorkerConfigured = true
}

export async function extractPdfTextFromArrayBuffer(
  buffer: ArrayBuffer,
  maxPages = 8,
): Promise<string> {
  ensurePdfWorkerConfigured()
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const pageCount = Math.min(pdf.numPages, maxPages)
  const chunks: string[] = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const items = textContent.items as Array<TextItem | TextMarkedContent>
    const pageText = items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (pageText.length > 0) {
      chunks.push(`[Page ${pageNumber}] ${pageText}`)
    }
  }

  return chunks.join('\n').trim().slice(0, 25000)
}
