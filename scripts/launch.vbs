Set oShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

oShell.CurrentDirectory = rootDir
cmd = "cmd.exe /c npx.cmd electron electron\main.cjs"
oShell.Run cmd, 0, False
