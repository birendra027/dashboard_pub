Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
d = fso.GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)
sh.CurrentDirectory = d
sh.Run q & d & "\bootstrap.cmd" & q & " stop", 0, False
