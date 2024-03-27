const vscode = require('vscode');
const path = require('path');
const { exec } = require('child_process');

// Create a diagnostic collection
let diagnosticCollection = vscode.languages.createDiagnosticCollection("myExtension");

function recompileErrors(document, context, flags) {
    const waccCompilePath = context.extensionPath + "/out/wacc-compiler";
    // Path to the currently open file
    const currentFilePath = document.uri.fsPath;

    return new Promise((resolve, reject) => {
        let _ret = 0;

        exec(`${waccCompilePath} ${currentFilePath} ${flags}`, async (error, stdout, stderr) => {
            if (error) {
                console.log(stdout);
                _ret = errorHandler(stdout);
                reject(_ret);
                return;
            }
            if (stderr) {
                _ret = errorHandler(stdout);
                reject(_ret);
                return;
            }
            // Process stdout if needed
            console.log(stdout);
            warningHandler(stdout);
            resolve(_ret);
        });
    });
}


async function warningHandler(warningString) {
    const _warnings = warningString.split("\n");
    const warnings = _warnings.filter(function(str) {
        return str != "";
    });
    
    const warningDiagnostics = warnings.map(addSimpleWarning);
    
    diagnosticCollection.set(vscode.Uri.file(vscode.window.activeTextEditor.document.fileName), warningDiagnostics);
    return warningDiagnostics.length;
}

// Function to add all syntactic or semantic errors
async function errorHandler(errorString) {
    const errors = errorString.split("\n\n");
    if(errors.length > 0) {
        errors.pop();
    }

    const diagnostics = errors.map(addSimpleError);

    // Add the diagnostics to the collection
    diagnosticCollection.set(vscode.Uri.file(vscode.window.activeTextEditor.document.fileName), diagnostics);
    return diagnostics.length;
} 

function addSimpleError(error) {
    //Extract error range
    const indexRangeStart = error.indexOf('(');
    const indexRangeEnd = error.indexOf(')');
    const rangeSubstring = error.substring(indexRangeStart+1, indexRangeEnd);
    const rangeSubstringSeparator = rangeSubstring.indexOf(',');
    const rangeStartRow = rangeSubstring.substring(0, rangeSubstringSeparator);
    const rangeStartCol = rangeSubstring.substring(rangeSubstringSeparator+2, rangeSubstring.length);

    const lines = error.substring(error.indexOf('|'), error.length);
    const errorLength = lines.split("^").length - 1;

    //Initialize problem parameters
    const problemRange = new vscode.Range(parseInt(rangeStartRow)-1, parseInt(rangeStartCol)-1, parseInt(rangeStartRow)-1, parseInt(rangeStartCol) + errorLength - 1);
    const problemSeverity = vscode.DiagnosticSeverity.Error;
    const problemMessage = error.substring(indexRangeEnd+1, error.indexOf('|'));

    // Create a diagnostic object
    const diagnostic = new vscode.Diagnostic(problemRange, problemMessage, problemSeverity);

    return diagnostic;
}

function addSimpleWarning(warningWithPrefix) {
    const warning = warningWithPrefix.substring(warningWithPrefix.indexOf(':')+2, warningWithPrefix.length)

    //Extract warning message
    const problemMessage = warning.substring(0, warning.indexOf('$'));

    //Extract warning ranges
    const ranges = warning.substring(warning.indexOf("$") + 2, warning.length - 1);


    //Start
    const indexRangeStartLeft = ranges.indexOf('(');
    const indexRangeStartRight = ranges.indexOf(')');
    const rangeSubstring = ranges.substring(indexRangeStartLeft+1, indexRangeStartRight);
    const rangeSubstringSeparator = rangeSubstring.indexOf(',');
    const rangeStartRow = rangeSubstring.substring(0, rangeSubstringSeparator);
    const rangeStartCol = rangeSubstring.substring(rangeSubstringSeparator+1, rangeSubstring.length);

    //End    
    const ranges2 = ranges.substring(indexRangeStartRight + 3, ranges.length);
    const indexRangeEndLeft = ranges2.indexOf('(');
    const indexRangeEndRight = ranges2.indexOf(')');
    const range2Substring = ranges2.substring(indexRangeEndLeft+1, indexRangeEndRight);
    const range2SubstringSeparator = range2Substring.indexOf(',');
    const rangeEndRow = range2Substring.substring(0, range2SubstringSeparator);
    const rangeEndCol = range2Substring.substring(range2SubstringSeparator+1, range2Substring.length);

    //Initialize problem parameters
    const problemRange = new vscode.Range(parseInt(rangeStartRow)-1, parseInt(rangeStartCol)-1, parseInt(rangeEndRow)-1, parseInt(rangeEndCol));
    const problemSeverity = vscode.DiagnosticSeverity.Warning;

    // Create a diagnostic object
    const diagnostic = new vscode.Diagnostic(problemRange, problemMessage, problemSeverity);

    return diagnostic;
}

function activate(context) {
    vscode.workspace.onDidChangeTextDocument(async event => {
        const document = event.document;
        const file = document.fileName;
        if(file.substring(file.lastIndexOf("."), file.length) === ".wacc") {
            try {
                const ret = await recompileErrors(document, context, "-p");
            } catch (error) {}
        }
    });

    let disposable = vscode.commands.registerCommand('wacc.run', async () => {
        console.log("Activated run command");

        const document = vscode.window.activeTextEditor.document;

        const terminalName = "WACC GCC";
        let terminalC = vscode.window.terminals.find(terminal => terminal.name === terminalName);

        if(!terminalC)
            terminalC = vscode.window.createTerminal(terminalName);
        
        try {
            const runnable = await recompileErrors(document, context, "-c -p");
            console.log("No errors found!");

            const directory = path.dirname(document.uri.fsPath);

            const fileName = path.parse(path.basename(document.uri.fsPath)).name;
            console.log(`gcc -o ${directory}/${fileName} -z noexecstack ${directory}/${fileName}.s`);
            exec(`gcc -o ${directory}/${fileName} -z noexecstack ${directory}/${fileName}.s`, (error, stdout, stderr) => {
                if (error) {
                    terminalC.sendText(`Error compiling: ${error}`, false);
                    terminalC.show();
                    return;
                }
                if (stderr) {
                    terminalC.sendText(`Compilation error: ${stderr}`, false);
                    terminalC.show();
                    return;
                }

                terminalC.sendText(`No errors found!`, false);
                runIO(`${directory}/${fileName}`);
            });

        } catch (error) { 
            await showErrorPopup("An error occurred, please resolve before re-running the WACC file.")
        }
    });

    context.subscriptions.push(disposable);
}

function runIO(exePath) {
    const terminalName = "WACC";
    let terminal = vscode.window.terminals.find(terminal => terminal.name === terminalName);
    if(terminal)
        terminal.dispose();

    terminal = vscode.window.createTerminal(terminalName);
    terminal.show();
    // Execute the program in the terminal
    terminal.sendText(exePath);
}

async function showErrorPopup(message) {
    await vscode.window.showErrorMessage(message, { modal: true }, 'Close');
}

exports.activate = activate;