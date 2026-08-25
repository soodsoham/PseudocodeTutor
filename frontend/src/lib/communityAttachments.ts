import { fastapi } from '../api/fastapi'
import { extractPdfTextFromArrayBuffer } from './pdfText'

interface CommunityAttachment {
  url?: unknown
  file_type?: unknown
  file_name?: unknown
}

interface ResolvedAttachment extends CommunityAttachment {
  url: string
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    const view = value
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    return bytes.slice().buffer
  }
  return null
}

function isPdfAttachment(attachment: CommunityAttachment): boolean {
  const fileType =
    typeof attachment.file_type === 'string'
      ? attachment.file_type.toLowerCase()
      : ''
  const fileName =
    typeof attachment.file_name === 'string'
      ? attachment.file_name.toLowerCase()
      : ''
  const url = typeof attachment.url === 'string' ? attachment.url.toLowerCase() : ''

  return (
    fileType.includes('pdf') || fileName.endsWith('.pdf') || url.endsWith('.pdf')
  )
}

function toAbsoluteAttachmentUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  const base = (fastapi.defaults.baseURL ?? '').replace(/\/$/, '')
  return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
}

export async function fetchCommunityProblemPdfContext(
  problemId: string | number,
): Promise<{ text: string; previewUrl: string | null }> {
  try {
    const listResponse = await fastapi.get<{
      attachments?: CommunityAttachment[]
    }>(`/community/problems/${encodeURIComponent(String(problemId))}/attachments`)

    const resolvedAttachments = (listResponse.data.attachments ?? [])
      .map((attachment) => {
        if (
          !attachment ||
          typeof attachment !== 'object' ||
          typeof attachment.url !== 'string' ||
          attachment.url.length === 0
        ) {
          return null
        }
        return {
          ...attachment,
          url: toAbsoluteAttachmentUrl(attachment.url),
        } as ResolvedAttachment
      })
      .filter((attachment): attachment is ResolvedAttachment => attachment !== null)

    const pdfAttachments = resolvedAttachments.filter((attachment) =>
      isPdfAttachment(attachment),
    )

    if (pdfAttachments.length === 0) {
      return { text: '', previewUrl: null }
    }

    const textChunks: string[] = []
    for (const attachment of pdfAttachments.slice(0, 2)) {
      try {
        const fileResponse = await fastapi.get<ArrayBuffer>(attachment.url, {
          responseType: 'arraybuffer',
        })
        const buffer = toArrayBuffer(fileResponse.data)
        if (!buffer) {
          continue
        }
        const extracted = await extractPdfTextFromArrayBuffer(buffer, 8)
        if (extracted.trim()) {
          textChunks.push(extracted.trim())
        }
      } catch {
        // Ignore per-file extraction failures and keep trying others.
      }
    }

    return {
      text: textChunks.join('\n\n').trim().slice(0, 25000),
      previewUrl: pdfAttachments[0]?.url ?? null,
    }
  } catch {
    return { text: '', previewUrl: null }
  }
}

export async function fetchCommunityProblemPdfText(
  problemId: string | number,
): Promise<string> {
  const context = await fetchCommunityProblemPdfContext(problemId)
  return context.text
}
