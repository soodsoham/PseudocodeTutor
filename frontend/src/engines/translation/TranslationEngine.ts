export interface TranslatedLine {
  pseudoLine: number
  codeLine: string
  isPending: boolean
}

export interface TranslationResult {
  lines: TranslatedLine[]
  hasOpenBlock: boolean
}

type BlockType =
  | 'FOR'
  | 'WHILE'
  | 'IF'
  | 'REPEAT'
  | 'PROCEDURE'
  | 'FUNCTION'
  | 'CASE'

type ConcreteTranslator = (
  trimmed: string,
  indentLevel: number,
  knownVariables: Set<string>,
) => string[]

interface LangConfig {
  translateLine: ConcreteTranslator
  simpleCloserLine: (blockType: BlockType, trimmed: string, indent: number) => string | null
  trailingElseLine: (indent: number) => string
  commentLine: (commentText: string, indent: number) => string
  caseStartLine: (expression: string, indent: number) => string
  caseClauseLine: (value: string, statement: string, indent: number) => string
  caseOtherwiseLine: (statement: string, indent: number) => string
  caseEndLine: (indent: number) => string
}

interface InputSpec {
  target: string
  declaredType: string | null
}

function extractBaseIdentifier(expression: string) {
  const match = expression.trim().match(/^([A-Za-z_]\w*)/)
  return match ? match[1] : null
}

function parseInputSpec(raw: string): InputSpec {
  const trimmed = raw.trim()
  const typedMatch = trimmed.match(/^(.+?)\s+AS\s+([A-Za-z_]\w*)$/i)
  const normalizeTarget = (value: string) => {
    const quotedIdentifier = value.trim().match(/^["']([A-Za-z_]\w*)["']$/)
    return quotedIdentifier ? quotedIdentifier[1] : value.trim()
  }
  if (typedMatch) {
    return {
      target: normalizeTarget(typedMatch[1]),
      declaredType: typedMatch[2].trim().toUpperCase(),
    }
  }
  return { target: normalizeTarget(trimmed), declaredType: null }
}

function parseDeclareSpec(raw: string) {
  const match = raw.trim().match(/^DECLARE\s+(.+?)\s*:\s*(ARRAY\s*\[[^\]]+\]\s+OF\s+[A-Za-z_]\w*|[A-Za-z_]\w*)$/i)
  if (!match) return null
  const names = match[1].split(',').map((name) => name.trim()).filter(isSimpleIdentifier)
  const declaredType = match[2].toUpperCase()
  const arrayMatch = declaredType.match(/^ARRAY\s*\[([^\]]+)\]\s+OF\s+([A-Z_]\w*)$/i)
  return names.length > 0
    ? { names, declaredType: arrayMatch ? arrayMatch[2].toUpperCase() : declaredType, arrayBounds: arrayMatch?.[1] ?? null }
    : null
}

function getPythonInputExpression(declaredType: string | null) {
  if (declaredType === 'STRING') {
    return 'str(input())'
  }
  if (declaredType === 'INTEGER') {
    return 'int(input())'
  }
  if (declaredType === 'REAL') {
    return 'float(input())'
  }
  if (declaredType === 'BOOLEAN') {
    return "input().strip().lower() in ('true', '1', 'yes', 'y')"
  }
  return 'input()'
}

function getJavaInputExpression(declaredType: string | null) {
  if (declaredType === 'INTEGER') {
    return 'Integer.parseInt(scanner.nextLine())'
  }
  if (declaredType === 'REAL') {
    return 'Double.parseDouble(scanner.nextLine())'
  }
  if (declaredType === 'BOOLEAN') {
    return 'Boolean.parseBoolean(scanner.nextLine())'
  }
  return 'scanner.nextLine()'
}

function getVbInputExpression(declaredType: string | null) {
  if (declaredType === 'INTEGER') {
    return 'Integer.Parse(Console.ReadLine())'
  }
  if (declaredType === 'REAL') {
    return 'Double.Parse(Console.ReadLine())'
  }
  if (declaredType === 'BOOLEAN') {
    return 'Boolean.Parse(Console.ReadLine())'
  }
  return 'Console.ReadLine()'
}

function isSimpleIdentifier(expression: string) {
  return /^[A-Za-z_]\w*$/.test(expression.trim())
}

function extractIndexedTargetParts(target: string) {
  const match = target.trim().match(/^([A-Za-z_]\w*)\s*\[(.+)\]$/)
  if (!match) {
    return null
  }
  return { base: match[1], indexExpr: match[2].trim() }
}

function extractIndexedBaseNames(text: string) {
  const baseNames = new Set<string>()
  const pattern = /([A-Za-z_]\w*)\s*\[[^\]]+\]/g
  let match: RegExpExecArray | null
  do {
    match = pattern.exec(text)
    if (match) {
      baseNames.add(match[1])
    }
  } while (match)
  return baseNames
}

function buildImplicitPythonArrayInitLines(sourceLines: string[]) {
  const hasInputLines = sourceLines.some((line) => /^INPUT\b/i.test(line.trim()))
  if (hasInputLines) {
    return [] as string[]
  }

  const readArrays = new Set<string>()
  const writtenArrays = new Set<string>()

  sourceLines.forEach((line) => {
    const trimmed = line.trim()
    extractIndexedBaseNames(trimmed).forEach((baseName) => readArrays.add(baseName))

    const assignmentMatch = trimmed.match(/^(.+?)\s*(?:←|<-|->)\s*.+$/)
    if (assignmentMatch) {
      const lhsBaseNames = extractIndexedBaseNames(assignmentMatch[1])
      lhsBaseNames.forEach((baseName) => writtenArrays.add(baseName))
    }
  })

  const arraysToInitialize = Array.from(readArrays).filter(
    (baseName) => !writtenArrays.has(baseName),
  )

  if (arraysToInitialize.length === 0) {
    return [] as string[]
  }

  return [
    'import random',
    ...arraysToInitialize.map(
      (baseName) => `${baseName} = {i: random.randint(10, 99) for i in range(1, 11)}`,
    ),
  ]
}

function buildIndexedArrayBaseNames(sourceLines: string[]) {
  const indexedBaseNames = new Set<string>()
  const declaredBaseNames = new Set<string>()

  sourceLines.forEach((line) => {
    const trimmed = line.trim()
    extractIndexedBaseNames(trimmed).forEach((baseName) => indexedBaseNames.add(baseName))

    const declareMatch = trimmed.match(/^DECLARE\s+(\w+)\s*:/i)
    if (declareMatch) {
      declaredBaseNames.add(declareMatch[1])
    }
  })

  return Array.from(indexedBaseNames).filter((baseName) => !declaredBaseNames.has(baseName))
}

function buildImplicitJavaArrayInitLines(sourceLines: string[]) {
  return buildIndexedArrayBaseNames(sourceLines).map(
    (baseName) => `String[] ${baseName} = new String[1001];`,
  )
}

function buildImplicitCppArrayInitLines(sourceLines: string[]) {
  return buildIndexedArrayBaseNames(sourceLines).map(
    (baseName) => `string ${baseName}[1001];`,
  )
}

function buildImplicitVbArrayInitLines(sourceLines: string[]) {
  return buildIndexedArrayBaseNames(sourceLines).map(
    (baseName) => `Dim ${baseName}(1000) As String`,
  )
}

const SIMPLE_CLOSER_PATTERNS: Array<{ pattern: RegExp; blockType: BlockType }> = [
  { pattern: /^ENDIF\b/i, blockType: 'IF' },
  { pattern: /^ENDWHILE\b/i, blockType: 'WHILE' },
  { pattern: /^ENDPROCEDURE\b/i, blockType: 'PROCEDURE' },
  { pattern: /^ENDFUNCTION\b/i, blockType: 'FUNCTION' },
  { pattern: /^ENDCASE\b/i, blockType: 'CASE' },
  { pattern: /^NEXT\b/i, blockType: 'FOR' },
]

function getIndent(level: number) {
  return '    '.repeat(Math.max(0, level))
}

function stripElseFromOutput(outputExpression: string) {
  let inQuotes = false

  for (let index = 0; index < outputExpression.length; index += 1) {
    const character = outputExpression[index]

    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (inQuotes) {
      continue
    }

    const remainder = outputExpression.slice(index)
    if (/^ELSE\b/i.test(remainder)) {
      return outputExpression.slice(0, index).trimEnd()
    }
  }

  return outputExpression.trim()
}

function hasTrailingElse(line: string) {
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (inQuotes) {
      continue
    }

    if (/^ELSE\b/i.test(line.slice(index).trimStart())) {
      return true
    }
  }

  return false
}

function splitInlineComment(rawLine: string) {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < rawLine.length - 1; index += 1) {
    const character = rawLine[index]
    const nextCharacter = rawLine[index + 1]

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (inSingleQuote || inDoubleQuote) {
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      return {
        codePart: rawLine.slice(0, index),
        commentPart: rawLine.slice(index + 2).trim(),
      }
    }
  }

  return { codePart: rawLine, commentPart: null as string | null }
}

function normalizeCondition(condition: string) {
  return condition
    .replace(/<>/g, '!=')
    .replace(/(?<![<>=!])=(?![=])/g, '==')
}

type LogicalOperator = 'AND' | 'OR'

interface LogicalConditionSplit {
  segments: string[]
  operators: LogicalOperator[]
}

function isWordBoundaryCharacter(character: string | undefined) {
  return character === undefined || !/[A-Za-z0-9_]/.test(character)
}

function splitConditionByLogicalOperators(condition: string): LogicalConditionSplit {
  const segments: string[] = []
  const operators: LogicalOperator[] = []
  let lastSegmentStart = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let depth = 0

  for (let index = 0; index < condition.length; index += 1) {
    const character = condition[index]

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (inSingleQuote || inDoubleQuote) {
      continue
    }

    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) {
      continue
    }

    const remainingUpper = condition.slice(index).toUpperCase()
    const before = condition[index - 1]

    if (
      remainingUpper.startsWith('AND') &&
      isWordBoundaryCharacter(before) &&
      isWordBoundaryCharacter(condition[index + 3])
    ) {
      segments.push(condition.slice(lastSegmentStart, index))
      operators.push('AND')
      index += 2
      lastSegmentStart = index + 1
      continue
    }

    if (
      remainingUpper.startsWith('OR') &&
      isWordBoundaryCharacter(before) &&
      isWordBoundaryCharacter(condition[index + 2])
    ) {
      segments.push(condition.slice(lastSegmentStart, index))
      operators.push('OR')
      index += 1
      lastSegmentStart = index + 1
    }
  }

  segments.push(condition.slice(lastSegmentStart))
  return { segments, operators }
}

function joinConditionWithLogicalOperators(
  split: LogicalConditionSplit,
  andToken: string,
  orToken: string,
) {
  return split.segments
    .map((segment) => segment.trim())
    .reduce((accumulator, segment, index) => {
      if (index === 0) {
        return segment
      }
      const operator = split.operators[index - 1] === 'AND' ? andToken : orToken
      return `${accumulator} ${operator} ${segment}`
    }, '')
}

function convertLogicalOperators(condition: string, andToken: string, orToken: string) {
  return joinConditionWithLogicalOperators(
    splitConditionByLogicalOperators(condition),
    andToken,
    orToken,
  )
}

function expandShorthandComparisons(condition: string) {
  const split = splitConditionByLogicalOperators(condition)
  let previousLeft: string | null = null
  let previousOperator: string | null = null

  const expandedSegments = split.segments.map((segment) => {
    const trimmed = segment.trim()
    if (trimmed.length === 0) {
      return trimmed
    }

    const comparisonMatch = trimmed.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/)
    if (comparisonMatch) {
      previousLeft = comparisonMatch[1].trim()
      previousOperator = comparisonMatch[2]
      return `${previousLeft} ${previousOperator} ${comparisonMatch[3].trim()}`
    }

    if (previousLeft !== null && previousOperator !== null) {
      return `${previousLeft} ${previousOperator} ${trimmed}`
    }

    return trimmed
  })

  return joinConditionWithLogicalOperators(
    { segments: expandedSegments, operators: split.operators },
    'AND',
    'OR',
  )
}

function isQuoted(value: string) {
  return /^".*"$/.test(value) || /^'.*'$/.test(value)
}

function isNumber(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value)
}

function normalizeConditionValue(value: string, knownVariables: Set<string>) {
  const trimmedValue = value.trim()

  if (
    trimmedValue.length === 0 ||
    isQuoted(trimmedValue) ||
    isNumber(trimmedValue) ||
    knownVariables.has(trimmedValue)
  ) {
    return trimmedValue
  }

  if (
    /^[A-Za-z_]\w*(?:\[[^\]]+\])+$/.test(trimmedValue) ||
    /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(trimmedValue) ||
    /^[A-Za-z_]\w*\(.*\)$/.test(trimmedValue)
  ) {
    return trimmedValue
  }

  if (/^[A-Za-z_]\w*$/.test(trimmedValue)) {
    return `"${trimmedValue}"`
  }

  return trimmedValue
}

function applyConditionRightHandQuoting(
  condition: string,
  knownVariables: Set<string>,
) {
  return condition.replace(
    /([A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*|\S+)\s*(==|!=|<=|>=|<|>)\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)/g,
    (_, left: string, operator: string, right: string) => {
      return `${left} ${operator} ${normalizeConditionValue(right, knownVariables)}`
    },
  )
}

function translateCondition(condition: string, knownVariables: Set<string>) {
  return applyConditionRightHandQuoting(
    expandShorthandComparisons(normalizeCondition(condition)),
    knownVariables,
  )
}

const CONDITION_TOKEN_PATTERN =
  '[A-Za-z_]\\w*(?:\\[[^\\]]+\\]|\\.[A-Za-z_]\\w*|\\([^)]*\\))*'
const QUOTED_STRING_PATTERN = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`

function applyCaseInsensitiveQuotedStringComparisons(
  condition: string,
  formatter: (token: string, literal: string, operator: '==' | '!=') => string,
) {
  const forwardPattern = new RegExp(
    `(${CONDITION_TOKEN_PATTERN})\\s*(==|!=)\\s*(${QUOTED_STRING_PATTERN})`,
    'g',
  )
  const reversePattern = new RegExp(
    `(${QUOTED_STRING_PATTERN})\\s*(==|!=)\\s*(${CONDITION_TOKEN_PATTERN})`,
    'g',
  )

  const forwardApplied = condition.replace(
    forwardPattern,
    (_match, token: string, operator: '==' | '!=', literal: string) =>
      formatter(token, literal, operator),
  )

  return forwardApplied.replace(
    reversePattern,
    (_match, literal: string, operator: '==' | '!=', token: string) =>
      formatter(token, literal, operator),
  )
}

function translateConditionPython(condition: string, knownVariables: Set<string>) {
  const normalized = translateCondition(condition, knownVariables)
  return convertLogicalOperators(
    applyCaseInsensitiveQuotedStringComparisons(
      normalized,
      (token, literal, operator) =>
        `str(${token}).casefold() ${operator} str(${literal}).casefold()`,
    ),
    'and',
    'or',
  )
}

function translateConditionJava(condition: string, knownVariables: Set<string>) {
  const baseCondition = applyCaseInsensitiveQuotedStringComparisons(
    translateCondition(condition, knownVariables),
    (token, literal, operator) => {
      const compare = `String.valueOf(${token}).equalsIgnoreCase(${literal})`
      return operator === '==' ? compare : `!${compare}`
    },
  )
  return convertLogicalOperators(
    baseCondition
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)\s*==\s*("(?:[^"\\]|\\.)*")/g,
      (_match, left: string, right: string) => `${left}.equals(${right})`,
    )
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)\s*!=\s*("(?:[^"\\]|\\.)*")/g,
      (_match, left: string, right: string) => `!${left}.equals(${right})`,
    )
    .replace(
      /("(?:[^"\\]|\\.)*")\s*==\s*([A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)/g,
      (_match, left: string, right: string) => `${left}.equals(${right})`,
    )
    .replace(
      /("(?:[^"\\]|\\.)*")\s*!=\s*([A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)/g,
      (_match, left: string, right: string) => `!${left}.equals(${right})`,
    )
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\]))\s*==\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)/g,
      (_match, left: string, right: string) => `${left}.equals(${right})`,
    )
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*==\s*([A-Za-z_]\w*(?:\[[^\]]+\]))/g,
      (_match, left: string, right: string) => `${left}.equals(${right})`,
    )
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\]))\s*!=\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)/g,
      (_match, left: string, right: string) => `!${left}.equals(${right})`,
    )
    .replace(
      /([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*!=\s*([A-Za-z_]\w*(?:\[[^\]]+\]))/g,
      (_match, left: string, right: string) => `!${left}.equals(${right})`,
    ),
    '&&',
    '||',
  )
}

function translateConditionVb(condition: string, knownVariables: Set<string>) {
  return convertLogicalOperators(
    applyCaseInsensitiveQuotedStringComparisons(
      translateCondition(condition, knownVariables),
      (token, literal, operator) => {
        const compare = `String.Equals(CStr(${token}), CStr(${literal}), StringComparison.OrdinalIgnoreCase)`
        return operator === '==' ? compare : `Not ${compare}`
      },
    )
      .replace(/!=/g, '<>')
      .replace(/==/g, '=')
      .replace(/([A-Za-z_]\w*)\s*\[([^\]]+)\]/g, '$1($2)'),
    'AndAlso',
    'OrElse',
  )
}

function translateConditionCpp(condition: string, knownVariables: Set<string>) {
  return convertLogicalOperators(
    applyCaseInsensitiveQuotedStringComparisons(
      translateCondition(condition, knownVariables),
      (token, literal, operator) => {
        const compare = `([](std::string __a, std::string __b){ std::transform(__a.begin(), __a.end(), __a.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); }); std::transform(__b.begin(), __b.end(), __b.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); }); return __a == __b; })(std::string(${token}), std::string(${literal}))`
        return operator === '==' ? compare : `!${compare}`
      },
    ),
    '&&',
    '||',
  )
}

function buildKnownVariables(sourceLines: string[], upToIndex: number): Set<string> {
  const knownVariables = new Set<string>()

  sourceLines.slice(0, upToIndex).forEach((previousLine) => {
    const previousTrimmed = previousLine.trim()
    let match = previousTrimmed.match(/^INPUT\s+(.+)$/i)
    if (match) {
      const inputSpec = parseInputSpec(match[1])
      const baseName = extractBaseIdentifier(inputSpec.target)
      if (baseName) {
        knownVariables.add(baseName)
      }
    }

    const declareSpec = parseDeclareSpec(previousTrimmed)
    if (declareSpec) {
      declareSpec.names.forEach((name) => knownVariables.add(name))
    }

    match = previousTrimmed.match(/^(?!FOR\b)(.+?)\s*(?:←|<-|->)\s*.+$/i)
    if (match) {
      const baseName = extractBaseIdentifier(match[1])
      if (baseName) {
        knownVariables.add(baseName)
      }
    }
  })

  return knownVariables
}

function annotateImplicitNumericInputs(sourceLines: string[]) {
  return sourceLines.map((line, index) => {
    const codePart = splitInlineComment(line).codePart
    const match = codePart.match(/^(\s*)INPUT\s+(.+)$/i)
    if (!match) return line
    const inputSpec = parseInputSpec(match[2])
    if (inputSpec.declaredType || !isSimpleIdentifier(inputSpec.target)) return line
    const escaped = inputSpec.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const laterText = sourceLines.slice(index + 1).join('\n').replace(/"[^"]*"|'[^']*'/g, '')
    const usedInArithmetic = new RegExp(
      `(?:\\b${escaped}\\b\\s*(?:[+*/-]|\\b(?:DIV|MOD)\\b)|(?:[+*/-])\\s*\\b${escaped}\\b)`,
      'i',
    ).test(laterText)
    return usedInArithmetic
      ? `${match[1]}INPUT ${inputSpec.target} AS INTEGER${line.slice(codePart.length)}`
      : line
  })
}

// ─── Python ───────────────────────────────────────────────────────────────────

function translateConcreteLinePython(
  trimmed: string,
  indentLevel: number,
  knownVariables: Set<string>,
): string[] {
  const indent = getIndent(indentLevel)

  let match = trimmed.match(/^CONSTANT\s+(\w+)\s*=\s*(.+)$/i)
  if (match) return [`${indent}${match[1]} = ${match[2].trim()}`]

  match = trimmed.match(/^FOR\s+(\w+)\s*(?:←|<-|->)\s*(.+)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i)
  if (match) {
    const [, variable, start, end, step = '1'] = match
    return [`${indent}for ${variable} in range(${start.trim()}, ${end.trim()} + (${step.trim()} if (${step.trim()}) > 0 else -1), ${step.trim()}):`]
  }

  match = trimmed.match(/^WHILE\s+(.+)\s+DO$/i)
  if (match) {
    return [`${indent}while ${translateConditionPython(match[1].trim(), knownVariables)}:`]
  }

  match = trimmed.match(/^IF\s+(.+)\s+THEN$/i)
  if (match) {
    return [`${indent}if ${translateConditionPython(match[1].trim(), knownVariables)}:`]
  }

  if (/^ELSE$/i.test(trimmed)) {
    return [`${indent}else:`]
  }

  if (/^REPEAT$/i.test(trimmed)) {
    return [`${indent}while True:`]
  }

  match = trimmed.match(/^UNTIL\s+(.+)$/i)
  if (match) {
    const condition = translateConditionPython(match[1].trim(), knownVariables)
    return [`${indent}if ${condition}: break`]
  }

  match = trimmed.match(/^PROCEDURE\s+(\w+)(?:\s*\((.*)\))?$/i)
  if (match) {
    return [`${indent}def ${match[1]}(${(match[2] ?? '').trim()}):`]
  }

  match = trimmed.match(/^FUNCTION\s+(\w+)(?:\s*\((.*)\))?(?:\s+RETURNS\s+\w+)?$/i)
  if (match) {
    return [`${indent}def ${match[1]}(${(match[2] ?? '').trim()}):`]
  }

  match = trimmed.match(/^(.+?)\s*(?:←|<-|->)\s*(.+)$/)
  if (match) {
    const target = match[1].trim()
    const value = match[2].trim()
    const indexedTarget = extractIndexedTargetParts(target)

    if (indexedTarget && !knownVariables.has(indexedTarget.base)) {
      return [
        `${indent}if '${indexedTarget.base}' not in locals(): ${indexedTarget.base} = {}`,
        `${indent}${indexedTarget.base}[${indexedTarget.indexExpr}] = ${value}`,
      ]
    }

    return [`${indent}${target} = ${value}`]
  }

  match = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/)
  if (match) {
    return [`${indent}${match[1]} = ${match[2].trim()}`]
  }

  match = trimmed.match(/^OUTPUT\s+(.+)$/i)
  if (match) {
    return [`${indent}print(${stripElseFromOutput(match[1]).replace(/\s*&\s*/g, ', ')})`]
  }

  match = trimmed.match(/^INPUT\s+(.+)$/i)
  if (match) {
    const inputSpec = parseInputSpec(match[1])
    const target = inputSpec.target
    const inputExpression = getPythonInputExpression(inputSpec.declaredType)
    const indexedTarget = extractIndexedTargetParts(target)

    if (indexedTarget && !knownVariables.has(indexedTarget.base)) {
      return [
        `${indent}if '${indexedTarget.base}' not in locals(): ${indexedTarget.base} = {}`,
        `${indent}${indexedTarget.base}[${indexedTarget.indexExpr}] = ${inputExpression}`,
      ]
    }

    return [`${indent}${target} = ${inputExpression}`]
  }

  const pythonDeclare = parseDeclareSpec(trimmed)
  if (pythonDeclare?.arrayBounds) {
    return pythonDeclare.names.map((name) => `${indent}${name} = {}`)
  }
  if (pythonDeclare) {
    // Python is dynamically typed; declarations have no executable equivalent.
    return ['']
  }

  match = trimmed.match(/^CALL\s+(\w+\s*\(.*\))$/i)
  if (match) {
    return [`${indent}${match[1].trim()}`]
  }

  match = trimmed.match(/^RETURN\s+(.+)$/i)
  if (match) {
    return [`${indent}return ${match[1].trim()}`]
  }

  if (trimmed.length === 0) {
    return ['']
  }

  return [`${indent}# ${trimmed}`]
}

// ─── Java ─────────────────────────────────────────────────────────────────────

const JAVA_TYPES: Record<string, string> = {
  INTEGER: 'int',
  STRING: 'String',
  REAL: 'double',
  BOOLEAN: 'boolean',
}

function translateConcreteLineJava(
  trimmed: string,
  indentLevel: number,
  knownVariables: Set<string>,
): string[] {
  const indent = getIndent(indentLevel)

  let match = trimmed.match(/^CONSTANT\s+(\w+)\s*=\s*(.+)$/i)
  if (match) return [`${indent}final var ${match[1]} = ${match[2].trim()};`]

  match = trimmed.match(/^FOR\s+(\w+)\s*(?:←|<-|->)\s*(.+)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i)
  if (match) {
    const [, variable, start, end, step = '1'] = match
    const increment = step.trim() === '1' ? `${variable}++` : `${variable} += ${step.trim()}`
    return [`${indent}for (int ${variable} = ${start.trim()}; ${variable} <= ${end.trim()}; ${increment}) {`]
  }

  match = trimmed.match(/^WHILE\s+(.+)\s+DO$/i)
  if (match) {
    return [`${indent}while (${translateConditionJava(match[1].trim(), knownVariables)}) {`]
  }

  match = trimmed.match(/^IF\s+(.+)\s+THEN$/i)
  if (match) {
    return [`${indent}if (${translateConditionJava(match[1].trim(), knownVariables)}) {`]
  }

  if (/^ELSE$/i.test(trimmed)) {
    return [`${indent}} else {`]
  }

  if (/^REPEAT$/i.test(trimmed)) {
    return [`${indent}do {`]
  }

  match = trimmed.match(/^UNTIL\s+(.+)$/i)
  if (match) {
    return [`${indent}} while (!(${translateConditionJava(match[1].trim(), knownVariables)}));`]
  }

  match = trimmed.match(/^PROCEDURE\s+(\w+)(?:\s*\((.*)\))?$/i)
  if (match) {
    return [`${indent}public static void ${match[1]}(${(match[2] ?? '').trim()}) {`]
  }

  match = trimmed.match(/^FUNCTION\s+(\w+)(?:\s*\((.*)\))?(?:\s+RETURNS\s+(\w+))?$/i)
  if (match) {
    return [`${indent}public static ${JAVA_TYPES[(match[3] ?? '').toUpperCase()] ?? 'Object'} ${match[1]}(${(match[2] ?? '').trim()}) {`]
  }

  match = trimmed.match(/^(.+?)\s*(?:←|<-|->)\s*(.+)$/)
  if (match) {
    const variable = match[1].trim()
    const value = match[2].trim()
    if (!isSimpleIdentifier(variable) || knownVariables.has(variable)) {
      return [`${indent}${variable} = ${value};`]
    }
    return [`${indent}var ${variable} = ${value};`]
  }

  match = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/)
  if (match) {
    const variable = match[1]
    return [`${indent}${knownVariables.has(variable) ? `${variable} = ${match[2].trim()};` : `var ${variable} = ${match[2].trim()};`}`]
  }

  match = trimmed.match(/^OUTPUT\s+(.+)$/i)
  if (match) {
    return [`${indent}System.out.println(${stripElseFromOutput(match[1])});`]
  }

  match = trimmed.match(/^INPUT\s+(.+)$/i)
  if (match) {
    const inputSpec = parseInputSpec(match[1])
    const target = inputSpec.target
    const inputExpression = getJavaInputExpression(inputSpec.declaredType)
    const declaredJavaType =
      inputSpec.declaredType !== null ? JAVA_TYPES[inputSpec.declaredType] ?? 'String' : 'String'
    const baseName = extractBaseIdentifier(target)
    if (!isSimpleIdentifier(target) || (baseName !== null && knownVariables.has(baseName))) {
      return [`${indent}${target} = ${inputExpression};`]
    }
    return [`${indent}${declaredJavaType} ${target} = ${inputExpression};`]
  }

  const javaDeclare = parseDeclareSpec(trimmed)
  if (javaDeclare) {
    const javaType = JAVA_TYPES[javaDeclare.declaredType] ?? 'Object'
    if (javaDeclare.arrayBounds) {
      const upper = javaDeclare.arrayBounds.split(':').pop()?.trim() ?? '100'
      return javaDeclare.names.map((name) => `${indent}${javaType}[] ${name} = new ${javaType}[${upper} + 1];`)
    }
    return [`${indent}${javaType} ${javaDeclare.names.join(', ')};`]
  }

  match = trimmed.match(/^CALL\s+(\w+\s*\(.*\))$/i)
  if (match) {
    return [`${indent}${match[1].trim()};`]
  }

  match = trimmed.match(/^RETURN\s+(.+)$/i)
  if (match) {
    return [`${indent}return ${match[1].trim()};`]
  }

  if (trimmed.length === 0) {
    return ['']
  }

  return [`${indent}// ${trimmed}`]
}

// ─── C++ ──────────────────────────────────────────────────────────────────────

const CPP_TYPES: Record<string, string> = {
  INTEGER: 'int',
  STRING: 'string',
  REAL: 'double',
  BOOLEAN: 'bool',
}

function translateConcreteLineCpp(
  trimmed: string,
  indentLevel: number,
  knownVariables: Set<string>,
): string[] {
  const indent = getIndent(indentLevel)

  let match = trimmed.match(/^CONSTANT\s+(\w+)\s*=\s*(.+)$/i)
  if (match) return [`${indent}const auto ${match[1]} = ${match[2].trim()};`]

  match = trimmed.match(/^FOR\s+(\w+)\s*(?:←|<-|->)\s*(.+)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i)
  if (match) {
    const [, variable, start, end, step = '1'] = match
    const increment = step.trim() === '1' ? `${variable}++` : `${variable} += ${step.trim()}`
    return [`${indent}for (int ${variable} = ${start.trim()}; ${variable} <= ${end.trim()}; ${increment}) {`]
  }

  match = trimmed.match(/^WHILE\s+(.+)\s+DO$/i)
  if (match) {
    return [`${indent}while (${translateConditionCpp(match[1].trim(), knownVariables)}) {`]
  }

  match = trimmed.match(/^IF\s+(.+)\s+THEN$/i)
  if (match) {
    return [`${indent}if (${translateConditionCpp(match[1].trim(), knownVariables)}) {`]
  }

  if (/^ELSE$/i.test(trimmed)) {
    return [`${indent}} else {`]
  }

  if (/^REPEAT$/i.test(trimmed)) {
    return [`${indent}do {`]
  }

  match = trimmed.match(/^UNTIL\s+(.+)$/i)
  if (match) {
    return [`${indent}} while (!(${translateConditionCpp(match[1].trim(), knownVariables)}));`]
  }

  match = trimmed.match(/^PROCEDURE\s+(\w+)(?:\s*\((.*)\))?$/i)
  if (match) {
    return [`${indent}void ${match[1]}(${(match[2] ?? '').trim()}) {`]
  }

  match = trimmed.match(/^FUNCTION\s+(\w+)(?:\s*\((.*)\))?(?:\s+RETURNS\s+(\w+))?$/i)
  if (match) {
    return [`${indent}auto ${match[1]}(${(match[2] ?? '').trim()}) {`]
  }

  match = trimmed.match(/^(.+?)\s*(?:←|<-|->)\s*(.+)$/)
  if (match) {
    const variable = match[1].trim()
    const value = match[2].trim()
    if (!isSimpleIdentifier(variable) || knownVariables.has(variable)) {
      return [`${indent}${variable} = ${value};`]
    }
    return [`${indent}auto ${variable} = ${value};`]
  }

  match = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/)
  if (match) {
    const variable = match[1]
    return [`${indent}${knownVariables.has(variable) ? `${variable} = ${match[2].trim()};` : `auto ${variable} = ${match[2].trim()};`}`]
  }

  match = trimmed.match(/^OUTPUT\s+(.+)$/i)
  if (match) {
    return [`${indent}cout << ${stripElseFromOutput(match[1])} << endl;`]
  }

  match = trimmed.match(/^INPUT\s+(.+)$/i)
  if (match) {
    const inputSpec = parseInputSpec(match[1])
    const target = inputSpec.target
    const declaredCppType =
      inputSpec.declaredType !== null ? CPP_TYPES[inputSpec.declaredType] ?? 'string' : 'string'
    const baseName = extractBaseIdentifier(target)
    if (!isSimpleIdentifier(target) || (baseName !== null && knownVariables.has(baseName))) {
      return [`${indent}cin >> ${target};`]
    }
    return [`${indent}${declaredCppType} ${target}; cin >> ${target};`]
  }

  const cppDeclare = parseDeclareSpec(trimmed)
  if (cppDeclare) {
    const cppType = CPP_TYPES[cppDeclare.declaredType] ?? 'auto'
    if (cppDeclare.arrayBounds) {
      const upper = cppDeclare.arrayBounds.split(':').pop()?.trim() ?? '100'
      return cppDeclare.names.map((name) => `${indent}${cppType} ${name}[${upper} + 1];`)
    }
    return [`${indent}${cppType} ${cppDeclare.names.join(', ')};`]
  }

  match = trimmed.match(/^CALL\s+(\w+\s*\(.*\))$/i)
  if (match) {
    return [`${indent}${match[1].trim()};`]
  }

  match = trimmed.match(/^RETURN\s+(.+)$/i)
  if (match) {
    return [`${indent}return ${match[1].trim()};`]
  }

  if (trimmed.length === 0) {
    return ['']
  }

  return [`${indent}// ${trimmed}`]
}

// ─── Visual Basic ─────────────────────────────────────────────────────────────

const VB_TYPES: Record<string, string> = {
  INTEGER: 'Integer',
  STRING: 'String',
  REAL: 'Double',
  BOOLEAN: 'Boolean',
}

function translateConcreteLineVb(
  trimmed: string,
  indentLevel: number,
  knownVariables: Set<string>,
): string[] {
  const indent = getIndent(indentLevel)
  const toVbIndexed = (expression: string) =>
    expression.replace(/([A-Za-z_]\w*)\s*\[([^\]]+)\]/g, '$1($2)')

  let match = trimmed.match(/^CONSTANT\s+(\w+)\s*=\s*(.+)$/i)
  if (match) return [`${indent}Const ${match[1]} = ${match[2].trim()}`]

  match = trimmed.match(/^FOR\s+(\w+)\s*(?:←|<-|->)\s*(.+)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i)
  if (match) {
    const [, variable, start, end, step] = match
    if (knownVariables.has(variable)) {
      return [`${indent}For ${variable} = ${start.trim()} To ${end.trim()}${step ? ` Step ${step.trim()}` : ''}`]
    }
    return [`${indent}For ${variable} As Integer = ${start.trim()} To ${end.trim()}${step ? ` Step ${step.trim()}` : ''}`]
  }

  match = trimmed.match(/^WHILE\s+(.+)\s+DO$/i)
  if (match) {
    return [`${indent}While ${translateConditionVb(match[1].trim(), knownVariables)}`]
  }

  match = trimmed.match(/^IF\s+(.+)\s+THEN$/i)
  if (match) {
    return [`${indent}If ${translateConditionVb(match[1].trim(), knownVariables)} Then`]
  }

  if (/^ELSE$/i.test(trimmed)) {
    return [`${indent}Else`]
  }

  if (/^REPEAT$/i.test(trimmed)) {
    return [`${indent}Do`]
  }

  match = trimmed.match(/^UNTIL\s+(.+)$/i)
  if (match) {
    return [`${indent}Loop Until ${translateConditionVb(match[1].trim(), knownVariables)}`]
  }

  match = trimmed.match(/^PROCEDURE\s+(\w+)(?:\s*\((.*)\))?$/i)
  if (match) {
    return [`${indent}Sub ${match[1]}(${(match[2] ?? '').trim()})`]
  }

  match = trimmed.match(/^FUNCTION\s+(\w+)(?:\s*\((.*)\))?(?:\s+RETURNS\s+\w+)?$/i)
  if (match) {
    return [`${indent}Function ${match[1]}(${(match[2] ?? '').trim()})`]
  }

  match = trimmed.match(/^(.+?)\s*(?:←|<-|->)\s*(.+)$/)
  if (match) {
    const variable = toVbIndexed(match[1].trim())
    const value = toVbIndexed(match[2].trim())
    if (!isSimpleIdentifier(variable) || knownVariables.has(variable)) {
      return [`${indent}${variable} = ${value}`]
    }
    return [`${indent}Dim ${variable} = ${value}`]
  }

  match = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/)
  if (match) {
    const variable = match[1]
    return [`${indent}${knownVariables.has(variable) ? `${variable} = ${match[2].trim()}` : `Dim ${variable} = ${match[2].trim()}`}`]
  }

  match = trimmed.match(/^OUTPUT\s+(.+)$/i)
  if (match) {
    return [`${indent}Console.WriteLine(${toVbIndexed(stripElseFromOutput(match[1]))})`]
  }

  match = trimmed.match(/^INPUT\s+(.+)$/i)
  if (match) {
    const inputSpec = parseInputSpec(match[1])
    const target = toVbIndexed(inputSpec.target)
    const inputExpression = getVbInputExpression(inputSpec.declaredType)
    const declaredVbType =
      inputSpec.declaredType !== null ? VB_TYPES[inputSpec.declaredType] ?? 'String' : 'String'
    const baseName = extractBaseIdentifier(target)
    if (!isSimpleIdentifier(target) || (baseName !== null && knownVariables.has(baseName))) {
      return [`${indent}${target} = ${inputExpression}`]
    }
    return [`${indent}Dim ${target} As ${declaredVbType} = ${inputExpression}`]
  }

  const vbDeclare = parseDeclareSpec(trimmed)
  if (vbDeclare) {
    const vbType = VB_TYPES[vbDeclare.declaredType] ?? 'Object'
    if (vbDeclare.arrayBounds) {
      const upper = vbDeclare.arrayBounds.split(':').pop()?.trim() ?? '100'
      return vbDeclare.names.map((name) => `${indent}Dim ${name}(${upper}) As ${vbType}`)
    }
    return [`${indent}Dim ${vbDeclare.names.map((name) => `${name} As ${vbType}`).join(', ')}`]
  }

  match = trimmed.match(/^CALL\s+(\w+\s*\(.*\))$/i)
  if (match) {
    return [`${indent}${match[1].trim()}`]
  }

  match = trimmed.match(/^RETURN\s+(.+)$/i)
  if (match) {
    return [`${indent}Return ${match[1].trim()}`]
  }

  if (trimmed.length === 0) {
    return ['']
  }

  return [`${indent}' ${trimmed}`]
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function translateToHtml(sourceLines: string[]): TranslationResult {
  const header: TranslatedLine = {
    pseudoLine: 1,
    codeLine: '<!-- HTML is a markup language and cannot directly represent pseudocode logic. Showing structure only. -->',
    isPending: false,
  }

  const lines: TranslatedLine[] = [header]

  sourceLines.forEach((rawLine, index) => {
    const { codePart, commentPart } = splitInlineComment(rawLine)
    const trimmed = codePart.trim()
    const pseudoLine = index + 1

    let codeLine: string

    if (trimmed.length === 0 && commentPart !== null) {
      lines.push({
        pseudoLine,
        codeLine: `<!-- ${commentPart} -->`,
        isPending: false,
      })
      return
    }

    const outputMatch = trimmed.match(/^OUTPUT\s+(.+)$/i)
    if (outputMatch) {
      codeLine = `<p>${outputMatch[1].trim()}</p>`
    } else if (trimmed.length === 0) {
      codeLine = ''
    } else {
      const declareMatch = trimmed.match(/^DECLARE\s+(\w+)\s*:\s*STRING$/i)
      if (declareMatch) {
        codeLine = `<!-- ${declareMatch[1]}: String -->`
      } else {
        codeLine = `<!-- ${trimmed} -->`
      }
    }

    lines.push({ pseudoLine, codeLine, isPending: false })

    if (commentPart !== null && commentPart.length > 0 && trimmed.length > 0) {
      lines.push({
        pseudoLine,
        codeLine: `<!-- ${commentPart} -->`,
        isPending: false,
      })
    }
  })

  return { lines, hasOpenBlock: false }
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

function translateToSql(sourceLines: string[]): TranslationResult {
  const header: TranslatedLine = {
    pseudoLine: 1,
    codeLine: '-- SQL is a query language. Showing approximate SQL representation.',
    isPending: false,
  }

  const lines: TranslatedLine[] = [header]

  sourceLines.forEach((rawLine, index) => {
    const { codePart, commentPart } = splitInlineComment(rawLine)
    const trimmed = codePart.trim()
    const pseudoLine = index + 1

    let codeLine: string

    if (trimmed.length === 0 && commentPart !== null) {
      lines.push({
        pseudoLine,
        codeLine: `-- ${commentPart}`,
        isPending: false,
      })
      return
    }

    const outputMatch = trimmed.match(/^OUTPUT\s+(.+)$/i)
    const inputMatch = trimmed.match(/^INPUT\s+(.+)$/i)
    const declareIntMatch = trimmed.match(/^DECLARE\s+(\w+)\s*:\s*INTEGER$/i)
    const declareStrMatch = trimmed.match(/^DECLARE\s+(\w+)\s*:\s*STRING$/i)
    const ifMatch = trimmed.match(/^IF\s+(.+)\s+THEN$/i)

    if (outputMatch) {
      codeLine = `SELECT ${outputMatch[1].trim()};`
    } else if (inputMatch) {
      codeLine = `-- Input: ${inputMatch[1]}`
    } else if (declareIntMatch) {
      codeLine = `DECLARE @${declareIntMatch[1]} INT;`
    } else if (declareStrMatch) {
      codeLine = `DECLARE @${declareStrMatch[1]} VARCHAR(255);`
    } else if (ifMatch) {
      codeLine = `IF ${ifMatch[1]} BEGIN`
    } else if (/^ENDIF$/i.test(trimmed)) {
      codeLine = 'END'
    } else if (trimmed.length === 0) {
      codeLine = ''
    } else {
      codeLine = `-- ${trimmed}`
    }

    lines.push({ pseudoLine, codeLine, isPending: false })

    if (commentPart !== null && commentPart.length > 0 && trimmed.length > 0) {
      lines.push({
        pseudoLine,
        codeLine: `-- ${commentPart}`,
        isPending: false,
      })
    }
  })

  return { lines, hasOpenBlock: false }
}

// ─── Language configs ─────────────────────────────────────────────────────────

function getPythonConfig(): LangConfig {
  return {
    translateLine: translateConcreteLinePython,
    simpleCloserLine: () => null,
    trailingElseLine: (indent) => `${getIndent(indent)}else:`,
    commentLine: (commentText, indent) => `${getIndent(indent)}# ${commentText}`,
    caseStartLine: (expression, indent) => `${getIndent(indent)}__case_value = ${expression}`,
    caseClauseLine: (value, statement, indent) => `${getIndent(indent)}if __case_value == ${value}: ${statement.trim()}`,
    caseOtherwiseLine: (statement, indent) => `${getIndent(indent)}else: ${statement.trim()}`,
    caseEndLine: () => '',
  }
}

function getJavaConfig(): LangConfig {
  return {
    translateLine: translateConcreteLineJava,
    simpleCloserLine: (_blockType, _trimmed, indent) => `${getIndent(indent)}}`,
    trailingElseLine: (indent) => `${getIndent(indent)}} else {`,
    commentLine: (commentText, indent) => `${getIndent(indent)}// ${commentText}`,
    caseStartLine: (expression, indent) => `${getIndent(indent)}switch (${expression}) {`,
    caseClauseLine: (value, statement, indent) => `${getIndent(indent)}case ${value}: ${statement.trim()} break;`,
    caseOtherwiseLine: (statement, indent) => `${getIndent(indent)}default: ${statement.trim()} break;`,
    caseEndLine: (indent) => `${getIndent(indent)}}`,
  }
}

function getCppConfig(): LangConfig {
  return {
    translateLine: translateConcreteLineCpp,
    simpleCloserLine: (_blockType, _trimmed, indent) => `${getIndent(indent)}}`,
    trailingElseLine: (indent) => `${getIndent(indent)}} else {`,
    commentLine: (commentText, indent) => `${getIndent(indent)}// ${commentText}`,
    caseStartLine: (expression, indent) => `${getIndent(indent)}switch (${expression}) {`,
    caseClauseLine: (value, statement, indent) => `${getIndent(indent)}case ${value}: ${statement.trim()} break;`,
    caseOtherwiseLine: (statement, indent) => `${getIndent(indent)}default: ${statement.trim()} break;`,
    caseEndLine: (indent) => `${getIndent(indent)}}`,
  }
}

function getVbConfig(): LangConfig {
  const VB_CLOSERS: Partial<Record<BlockType, string>> = {
    IF: 'End If',
    WHILE: 'End While',
    PROCEDURE: 'End Sub',
    FUNCTION: 'End Function',
  }

  return {
    translateLine: translateConcreteLineVb,
    simpleCloserLine: (blockType, trimmed, indent) => {
      if (blockType === 'FOR') {
        const varMatch = trimmed.match(/^NEXT\s+(\w+)/i)
        return `${getIndent(indent)}Next ${varMatch?.[1] ?? ''}`.trimEnd()
      }
      const keyword = VB_CLOSERS[blockType]
      return keyword !== undefined ? `${getIndent(indent)}${keyword}` : null
    },
    trailingElseLine: (indent) => `${getIndent(indent)}Else`,
    commentLine: (commentText, indent) => `${getIndent(indent)}' ${commentText}`,
    caseStartLine: (expression, indent) => `${getIndent(indent)}Select Case ${expression}`,
    caseClauseLine: (value, statement, indent) => `${getIndent(indent)}Case ${value}: ${statement.trim()}`,
    caseOtherwiseLine: (statement, indent) => `${getIndent(indent)}Case Else: ${statement.trim()}`,
    caseEndLine: (indent) => `${getIndent(indent)}End Select`,
  }
}

// ─── Shared block-language translation loop ───────────────────────────────────

function translateBlockLanguage(
  sourceLines: string[],
  config: LangConfig,
): TranslationResult {
  const translatedLines: TranslatedLine[] = []
  const blockStack: BlockType[] = []
  let indentLevel = 0

  sourceLines.forEach((rawLine, index) => {
    const { codePart, commentPart } = splitInlineComment(rawLine)
    const trimmed = codePart.trim()
    const pseudoLine = index + 1
    const knownVariables = buildKnownVariables(sourceLines, index)

    if (blockStack[blockStack.length - 1] === 'CASE') {
      const otherwiseMatch = trimmed.match(/^OTHERWISE\s*:?(.*)$/i)
      const clauseMatch = trimmed.match(/^(.+?)\s*:\s*(.+)$/)
      if (otherwiseMatch || clauseMatch) {
        const value = otherwiseMatch ? '' : clauseMatch?.[1]?.trim() ?? ''
        const statement = otherwiseMatch ? otherwiseMatch[1].trim() : clauseMatch?.[2]?.trim() ?? ''
        const translatedStatement = config.translateLine(statement, indentLevel, knownVariables)
          .filter((line) => line.trim().length > 0)
          .map((line) => line.trim())
          .join(' ')
        translatedLines.push({
          pseudoLine,
          codeLine: otherwiseMatch
            ? config.caseOtherwiseLine(translatedStatement, indentLevel)
            : config.caseClauseLine(value, translatedStatement, indentLevel),
          isPending: false,
        })
        return
      }
    }

    if (trimmed.length === 0 && commentPart !== null) {
      translatedLines.push({
        pseudoLine,
        codeLine: config.commentLine(commentPart, indentLevel),
        isPending: false,
      })
      return
    }

    const caseStart = trimmed.match(/^CASE\s+OF\s+(.+)$/i)
    if (caseStart) {
      blockStack.push('CASE')
      translatedLines.push({
        pseudoLine,
        codeLine: config.caseStartLine(caseStart[1].trim(), indentLevel),
        isPending: false,
      })
      return
    }

    if (/^ENDCASE$/i.test(trimmed)) {
      if (blockStack[blockStack.length - 1] === 'CASE') blockStack.pop()
      translatedLines.push({
        pseudoLine,
        codeLine: config.caseEndLine(indentLevel),
        isPending: false,
      })
      return
    }

    // Simple closers: ENDIF, ENDWHILE, ENDPROCEDURE, ENDFUNCTION, NEXT
    for (const { pattern, blockType } of SIMPLE_CLOSER_PATTERNS) {
      if (pattern.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1)
        if (blockStack[blockStack.length - 1] === blockType) {
          blockStack.pop()
        }
        const line = config.simpleCloserLine(blockType, trimmed, indentLevel)
        if (line !== null) {
          translatedLines.push({ pseudoLine, codeLine: line, isPending: false })
        }
        return
      }
    }

    // UNTIL
    if (/^UNTIL\s+.+$/i.test(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1)
      if (blockStack[blockStack.length - 1] === 'REPEAT') {
        blockStack.pop()
      }
      config.translateLine(trimmed, indentLevel, knownVariables).forEach((codeLine) => {
        translatedLines.push({ pseudoLine, codeLine, isPending: false })
      })
      return
    }

    // ELSE
    if (/^ELSE$/i.test(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1)
      config.translateLine(trimmed, indentLevel, knownVariables).forEach((codeLine) => {
        translatedLines.push({ pseudoLine, codeLine, isPending: false })
      })
      indentLevel += 1
      if (blockStack[blockStack.length - 1] !== 'IF') {
        blockStack.push('IF')
      }
      return
    }

    // OUTPUT with trailing ELSE
    if (/^OUTPUT\s+.+$/i.test(trimmed) && hasTrailingElse(trimmed)) {
      config.translateLine(trimmed, indentLevel, knownVariables).forEach((codeLine) => {
        translatedLines.push({ pseudoLine, codeLine, isPending: false })
      })
      indentLevel = Math.max(0, indentLevel - 1)
      translatedLines.push({
        pseudoLine,
        codeLine: config.trailingElseLine(indentLevel),
        isPending: false,
      })
      indentLevel += 1
      return
    }

    // Normal line
    config.translateLine(trimmed, indentLevel, knownVariables).forEach((codeLine) => {
      translatedLines.push({ pseudoLine, codeLine, isPending: false })
    })

    if (commentPart !== null && commentPart.length > 0) {
      translatedLines.push({
        pseudoLine,
        codeLine: config.commentLine(commentPart, indentLevel),
        isPending: false,
      })
    }

    // Block openers — push stack and increase indent after emitting the opening line
    if (/^FOR\s+\w+\s*(?:←|<-|->)\s*.+\s+TO\s+.+?(?:\s+STEP\s+.+)?$/i.test(trimmed)) {
      blockStack.push('FOR')
      indentLevel += 1
    } else if (/^WHILE\s+.+\s+DO$/i.test(trimmed)) {
      blockStack.push('WHILE')
      indentLevel += 1
    } else if (/^IF\s+.+\s+THEN$/i.test(trimmed)) {
      blockStack.push('IF')
      indentLevel += 1
    } else if (/^REPEAT$/i.test(trimmed)) {
      blockStack.push('REPEAT')
      indentLevel += 1
    } else if (/^PROCEDURE\s+\w+\s*\(.*\)$/i.test(trimmed)) {
      blockStack.push('PROCEDURE')
      indentLevel += 1
    } else if (/^FUNCTION\s+\w+\s*\(.*\)$/i.test(trimmed)) {
      blockStack.push('FUNCTION')
      indentLevel += 1
    }
  })

  return {
    lines: translatedLines,
    hasOpenBlock: blockStack.length > 0,
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function translatePseudocode(
  pseudocode: string,
  language: string,
): TranslationResult {
  const sourceLines = annotateImplicitNumericInputs(pseudocode.split('\n'))

  if (language === 'html') {
    return translateToHtml(sourceLines)
  }

  if (language === 'sql') {
    return translateToSql(sourceLines)
  }

  const configMap: Record<string, LangConfig> = {
    python: getPythonConfig(),
    java: getJavaConfig(),
    cpp: getCppConfig(),
    vb: getVbConfig(),
  }

  const config = configMap[language]

  if (!config) {
    return {
      lines: sourceLines.map((line, index) => ({
        pseudoLine: index + 1,
        codeLine: line.trim().length > 0 ? `// ${line.trim()}` : '',
        isPending: false,
      })),
      hasOpenBlock: false,
    }
  }

  const translated = translateBlockLanguage(sourceLines, config)

  if (language === 'python') {
    const implicitInitLines = buildImplicitPythonArrayInitLines(sourceLines)
    if (implicitInitLines.length === 0) {
      return translated
    }

    return {
      lines: [
        ...implicitInitLines.map((codeLine) => ({
          pseudoLine: 1,
          codeLine,
          isPending: false,
        })),
        ...translated.lines,
      ],
      hasOpenBlock: translated.hasOpenBlock,
    }
  }

  const implicitInitLinesByLanguage: Record<string, string[]> = {
    java: buildImplicitJavaArrayInitLines(sourceLines),
    cpp: buildImplicitCppArrayInitLines(sourceLines),
    vb: buildImplicitVbArrayInitLines(sourceLines),
  }

  const implicitInitLines = implicitInitLinesByLanguage[language] ?? []
  if (implicitInitLines.length === 0) {
    return translated
  }

  return {
    lines: [
      ...implicitInitLines.map((codeLine) => ({
        pseudoLine: 1,
        codeLine,
        isPending: false,
      })),
      ...translated.lines,
    ],
    hasOpenBlock: translated.hasOpenBlock,
  }
}
