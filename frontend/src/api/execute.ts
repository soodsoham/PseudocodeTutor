import axios, { AxiosError } from 'axios'

type ExecutePayload = {
  language: string
  code: string
  stdin?: string
}

type ExecuteResult = {
  stdout: string
  stderr: string
  htmlPreview?: string
}

const judge0 = axios.create({
  baseURL: import.meta.env.VITE_JUDGE0_API_URL ?? 'https://ce.judge0.com',
  timeout: 20000,
})

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase()
}

function normalizeCode(code: string) {
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function indentBlock(code: string, spaces: number) {
  const pad = ' '.repeat(spaces)
  return normalizeCode(code)
    .split('\n')
    .map((line) => (line.trim().length === 0 ? '' : `${pad}${line}`))
    .join('\n')
}

function wrapVisualBasicCode(code: string) {
  const normalized = normalizeCode(code)
    .replace(/!=/g, '<>')
    .replace(/==/g, '=')
    .trim()

  const withStrictReads = normalized
    .split('\n')
    .map((line) => {
      const dimInputMatch = line.match(
        /^(\s*Dim\s+)([A-Za-z_]\w*(?:\([^)]+\))?)(\s+As\s+\w+\s*=\s*)(.+)$/i,
      )
      if (dimInputMatch) {
        const [, prefix, target, asClause, rhs] = dimInputMatch
        if (/Console\.ReadLine\(\)/i.test(rhs)) {
          return `${prefix}${target}${asClause}${rhs.replace(
            /Console\.ReadLine\(\)/i,
            `ReadRequired("${target}")`,
          )}`
        }
      }

      const assignInputMatch = line.match(
        /^(\s*)([A-Za-z_]\w*(?:\([^)]+\))?)\s*=\s*(.+)$/i,
      )
      if (assignInputMatch) {
        const [, indent, target, rhs] = assignInputMatch
        if (/Console\.ReadLine\(\)/i.test(rhs)) {
          return `${indent}${target} = ${rhs.replace(
            /Console\.ReadLine\(\)/i,
            `ReadRequired("${target}")`,
          )}`
        }
      }

      return line
    })
    .join('\n')

  if (normalized.length === 0) {
    return 'Imports System\n\nModule Program\n    Sub Main()\n    End Sub\nEnd Module'
  }

  if (/^\s*Module\b/im.test(withStrictReads)) {
    return withStrictReads
  }

  return [
    'Imports System',
    '',
    'Module Program',
    '    Private Function ReadRequired(ByVal target As String) As String',
    '        Dim value As String = Console.ReadLine()',
    '        If value Is Nothing Then',
    '            Throw New Exception("EOFError|" & target)',
    '        End If',
    '        Return value',
    '    End Function',
    '',
    '    Sub Main()',
    indentBlock(withStrictReads, 8),
    '    End Sub',
    'End Module',
  ].join('\n')
}

function wrapPythonCode(code: string) {
  const normalized = normalizeCode(code).trimEnd()
  return normalized.length > 0 ? `${normalized}\n` : ''
}

function wrapJavaCode(code: string) {
  const normalized = normalizeCode(code).trim()

  if (normalized.length === 0) {
    return 'public class Main { public static void main(String[] args) {} }'
  }

  if (/\bclass\s+Main\b/.test(normalized)) {
    return normalized
  }

  const lines = normalized.split('\n')
  const mainLines: string[] = []
  const methodBlocks: string[] = []

  const isMethodDeclaration = (line: string) => {
    const trimmed = line.trim()
    return (
      /^public\s+static\s+\w[\w<>[\]]*\s+\w+\s*\([^)]*\)\s*\{?\s*$/i.test(trimmed) &&
      !/^public\s+static\s+void\s+main\s*\(/i.test(trimmed)
    )
  }

  const braceDelta = (line: string) => {
    let delta = 0
    for (const char of line) {
      if (char === '{') {
        delta += 1
      } else if (char === '}') {
        delta -= 1
      }
    }
    return delta
  }

  let collectingMethod = false
  let currentMethod: string[] = []
  let depth = 0

  lines.forEach((line) => {
    if (!collectingMethod && isMethodDeclaration(line)) {
      collectingMethod = true
      currentMethod = [line]
      depth = braceDelta(line)
      if (depth <= 0) {
        methodBlocks.push(currentMethod.join('\n'))
        currentMethod = []
        collectingMethod = false
      }
      return
    }

    if (collectingMethod) {
      currentMethod.push(line)
      depth += braceDelta(line)
      if (depth <= 0) {
        methodBlocks.push(currentMethod.join('\n'))
        currentMethod = []
        collectingMethod = false
      }
      return
    }

    mainLines.push(line)
  })

  if (currentMethod.length > 0) {
    mainLines.push(...currentMethod)
  }

  const classMethodSection =
    methodBlocks.length > 0 ? `${indentBlock(methodBlocks.join('\n\n'), 4)}\n\n` : ''
  const mainSection = mainLines.join('\n').trim()
  const indentedMain = mainSection.length > 0 ? indentBlock(mainSection, 8) : ''

  return [
    'import java.util.*;',
    '',
    'public class Main {',
    '    private static final Scanner scanner = new Scanner(System.in);',
    '',
    classMethodSection,
    '    public static void main(String[] args) {',
    indentedMain,
    '    }',
    '}',
  ].join('\n')
}

function wrapCppCode(code: string) {
  const normalized = normalizeCode(code).trim()
  const withStrictReads = normalized
    .split('\n')
    .map((line) => {
      const declarationAndInputMatch = line.match(
        /^(\s*\w[\w:<>[\]]*\s+[A-Za-z_]\w*(?:\[[^\]]+\])?\s*;\s*)cin\s*>>\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*;\s*$/,
      )
      if (declarationAndInputMatch) {
        const [, declaration, target] = declarationAndInputMatch
        return `${declaration}ReadRequired(${target}, "${target}");`
      }

      const inputMatch = line.match(
        /^(\s*)cin\s*>>\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*;\s*$/,
      )
      if (inputMatch) {
        const [, indent, target] = inputMatch
        return `${indent}ReadRequired(${target}, "${target}");`
      }

      return line
    })
    .join('\n')

  if (normalized.length === 0) {
    return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    return 0;\n}'
  }

  if (/int\s+main\s*\(/.test(withStrictReads)) {
    return withStrictReads
  }

  return [
    '#include <bits/stdc++.h>',
    'using namespace std;',
    '',
    'template <typename T>',
    'void ReadRequired(T& target, const string& targetName) {',
    '    if (!(cin >> target)) {',
    '        throw runtime_error("EOFError|" + targetName);',
    '    }',
    '}',
    '',
    'int main() {',
    indentBlock(withStrictReads, 4),
    '    return 0;',
    '}',
  ].join('\n')
}

async function runWithJudge0(
  languageId: number,
  payload: ExecutePayload,
  sourceCode: string = payload.code,
): Promise<ExecuteResult> {
  try {
    const response = await judge0.post('/submissions?base64_encoded=false&wait=true', {
      language_id: languageId,
      source_code: sourceCode,
      stdin: payload.stdin ?? '',
    })

    const stdout = response.data?.stdout ?? ''
    const compileOutput = response.data?.compile_output ?? ''
    const stderr = response.data?.stderr ?? ''
    const message = response.data?.message ?? ''
    const statusId = response.data?.status?.id
    const statusDescription = response.data?.status?.description ?? ''
    const accepted =
      statusId === 3 || (typeof statusDescription === 'string' && statusDescription === 'Accepted')
    const combinedError = [accepted ? '' : compileOutput, stderr, message]
      .filter((part: unknown) => typeof part === 'string' && part.trim().length > 0)
      .join('\n')

    return {
      stdout: typeof stdout === 'string' ? stdout : '',
      stderr:
        combinedError ||
        (typeof statusDescription === 'string' &&
        statusDescription.length > 0 &&
        statusDescription !== 'Accepted'
          ? statusDescription
          : ''),
    }
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>
    const message =
      axiosError.response?.data?.message ??
      axiosError.message ??
      'Execution service is unavailable right now.'

    return {
      stdout: '',
      stderr: message,
    }
  }
}

function runHtmlPreview(payload: ExecutePayload): ExecuteResult {
  return {
    stdout: 'HTML preview generated below.',
    stderr: '',
    htmlPreview: payload.code,
  }
}

async function runPython(payload: ExecutePayload) {
  // Python (3.11.2)
  return runWithJudge0(92, payload, wrapPythonCode(payload.code))
}

async function runVisualBasic(payload: ExecutePayload) {
  // Visual Basic.Net (vbnc 0.0.0.5943)
  return runWithJudge0(84, payload, wrapVisualBasicCode(payload.code))
}

async function runJava(payload: ExecutePayload) {
  // Java (JDK 17.0.6)
  return runWithJudge0(91, payload, wrapJavaCode(payload.code))
}

async function runCpp(payload: ExecutePayload) {
  // C++ (GCC 14.1.0)
  return runWithJudge0(105, payload, wrapCppCode(payload.code))
}

async function runSql(payload: ExecutePayload) {
  // SQL (SQLite 3.27.2)
  return runWithJudge0(82, payload)
}

export async function executeCode(payload: ExecutePayload): Promise<ExecuteResult> {
  const language = normalizeLanguage(payload.language)

  if (language === 'python') {
    return runPython(payload)
  }
  if (language === 'vb') {
    return runVisualBasic(payload)
  }
  if (language === 'java') {
    return runJava(payload)
  }
  if (language === 'cpp') {
    return runCpp(payload)
  }
  if (language === 'sql') {
    return runSql(payload)
  }
  if (language === 'html') {
    return runHtmlPreview(payload)
  }

  return {
    stdout: '',
    stderr: `Execution for "${payload.language}" is not configured yet.`,
  }
}
