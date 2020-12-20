import { Token, TokenTypes } from '../common';

const SeparatorsMap: Record<string, string[]> = {
    '\n': ['\n'],
    '=': ['=', '==', '=>'],

    '+': ['+', '++', '+='],
    '-': ['-', '--', '-='],
    '*': ['*', '**', '*='],
    '/': ['/', '//', '/='],

    '.': ['.'],
    '?': ['?'],
    '!': ['!='],
    ':': [':'],
    ',': [','],

    '>': ['>', '>='],
    '<': ['<', '<=', '<>'],

    '(': ['('],
    ')': [')'],
    '{': ['{'],
    '}': ['}'],
    '[': ['['],
    ']': [']'],
};

const Keywords: string[] = ["async", "def", "for", "while", "if", "return", "in"];

export class Tokenizer {
    private _startLine: number = 1
    private _startColumn: number = 1
    private _currentLine: number = 1
    private _currentColumn: number = 1
    private _tokenText = '';
    private _cursor = 0;
    private _script = "";

    private get tokenText(): string {
        return this._tokenText;
    }
    private set tokenText(value: string) {
        if (!this._tokenText && value) {
            this._startLine = this._currentLine;
            this._startColumn = this._currentColumn;
        }
        this._tokenText = value;
    }

    /**
     * Splits script code into a tokens
     * @param script A jsPython text
     */
    tokenize(script: string): Token[] {
        if (!script || !script.length) { return []; }

        script = script
            .replace(new RegExp('\t', 'g'), '  ') // replace all tabs with 2 spaces
            .replace(new RegExp('\r', 'g'), ''); // remove all \r symbols
        this._script = script;

        this._cursor = 0;
        this._startLine = 1;
        this._startColumn = 1;
        this._currentLine = 1;
        this._currentColumn = 1;

        const tokens: Token[] = [];

        let first = true;
        // handle initial spaces
        while (script[this._cursor] === '\n') {
            this.incrementCursor();
            if (first) {
                this._currentLine++;
                first = false;
            }
            this._currentColumn = 1;
        }

        do {
            const symbol = script[this._cursor];

            if (symbol == ' ' && this.tokenText.length !== 0) {
                this.tokenText = this.processToken(this.tokenText, tokens);
                continue;
            } else if ((SeparatorsMap[symbol]) && !this.isPartOfNumber(symbol, this.tokenText, this._cursor)) {
                // handle numbers with floating point e.g. 3.14
                this.tokenText = this.processToken(this.tokenText, tokens);
                this.tokenText = symbol;

                const sepsMap = SeparatorsMap[symbol];

                if (sepsMap.length > 1) {
                    // process longer operators
                    while (sepsMap.includes(this.tokenText + script[this._cursor + 1])) {
                        this.tokenText += script[this.incrementCursor()];
                    }
                }
                this.tokenText = this.processToken(this.tokenText, tokens, false, TokenTypes.Operator);

            } else if (symbol === '#') {

                while (script[this.incrementCursor()] !== '\n') {
                    this.tokenText += script[this._cursor];
                    if (this._cursor + 1 >= script.length) break;
                }
                this.tokenText = this.processToken(this.tokenText, tokens, true, TokenTypes.Comment);

            } else if (symbol === '"' || symbol === "'") {
                // remember either it is single or double quote
                const q = symbol;
                // we are not expecting token to be added here.
                // it should pass a failt to parser
                this.tokenText = this.processToken(this.tokenText, tokens);

                // handle """ comment """"
                if (script[this._cursor + 1] === q && script[this._cursor + 2] === q) {
                    this.incrementCursor(2);
                    while (true) {
                        this.tokenText += script[this.incrementCursor()];
                        if (this._cursor + 3 >= script.length
                            || (script[this._cursor + 1] === q && script[this._cursor + 2] === q && script[this._cursor + 3] === q)) {
                            break;
                        }
                    }
                    this.incrementCursor(3);
                } else {
                    while (script[this.incrementCursor()] !== q) {
                        this.tokenText += script[this._cursor];
                        if (this._cursor + 1 >= script.length) break;
                    }
                }
                
                // a special case when empty string
                if(this.tokenText.length === 0) {
                    this._startLine = this._currentLine;
                    this._startColumn = this._currentColumn;
                }
                this.tokenText = this.processToken(this.tokenText, tokens, true, TokenTypes.LiteralString);
            } else if (symbol != ' ') {
                this.tokenText += symbol;
            }
        }
        while (this.incrementCursor() < script.length)

        this.processToken(this.tokenText, tokens);

        return tokens;
    }

    private incrementCursor(count: number = 1): number {
        for (let i = 0; i < count; i++) {
            this._cursor = this._cursor + 1;
            if (this._script[this._cursor] === '\n') {
                this._currentLine++;
                this._currentColumn = 0;
            } else {
                this._currentColumn++;
            }
        }

        return this._cursor;
    }

    private recognizeToken(tokenText: string, type: TokenTypes | null = null): { value: string | number | boolean | null, type: TokenTypes } {

        let value: string | number | boolean | null = tokenText;

        if (type === null) {
            if (tokenText === 'null') {
                type = TokenTypes.LiteralNull;
                value = null;
            } else if (tokenText === 'true' || tokenText === 'false') {
                type = TokenTypes.LiteralBool;
                value = tokenText === 'true';
            } else if (this.parseNumberOrNull(tokenText) !== null) {
                type = TokenTypes.LiteralNumber;
                value = this.parseNumberOrNull(tokenText);
            } else if (Keywords.indexOf(tokenText) >= 0) {
                type = TokenTypes.Keyword;
            } else {
                type = TokenTypes.Identifier
            }
        }

        return {
            value: value,
            type: type
        }

    }

    private processToken(strToken: string, tokens: Token[], allowEmptyString = false, type: TokenTypes | null = null): string {
        // ignore empty tokens
        if (!strToken.length && !allowEmptyString || strToken === '\n') return "";

        const token = this.recognizeToken(strToken, type);
        tokens.push([token.value, Uint16Array.of(token.type as number,
            this._startLine, this._startColumn,
            this._currentLine, this._currentColumn)] as Token)
        return "";
    }

    private parseNumberOrNull(value: string | number): number | null {
        if (typeof value === 'number') {
            return value;
        }

        if (!value || typeof value !== 'string') {
            return null;
        }

        value = value.trim();

        // Just to make sure string contains digits only and '.', ','. Otherwise, parseFloat can incorrectly parse into number
        for (let i = value.length - 1; i >= 0; i--) {
            const d = value.charCodeAt(i);
            if (d < 48 || d > 57) {
                // '.' - 46 ',' - 44 '-' - 45(but only first char)
                if (d !== 46 && d !== 44 && (d !== 45 || i !== 0))
                    return null;
            }
        }

        const res = parseFloat(value);
        return !isNaN(res) ? res : null;
    }

    private isPartOfNumber(symbol: string, token: string, cursor: number): boolean {
        // '-' needs to be handled e.g. -3; 2 + -2 etc
        // if(token.length == 0 && symbol === '-') {
        //     return true;
        // }
        if (symbol === '.' && this.parseNumberOrNull(token)) {
            return true;
        }
        return false;
    }
}