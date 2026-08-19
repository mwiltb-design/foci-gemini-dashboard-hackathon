Set oShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

devPs1 = rootDir & "\scripts\dev.ps1"
cmd = "powershell.exe -ExecutionPolicy Bypass -File """ & devPs1 & """"
oShell.Run cmd, 0, False
