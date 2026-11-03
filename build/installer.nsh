; 自定义 NSIS 钩子（electron-builder 会自动 include 本文件）
;
; 1. 注册 Applications\VideoPlayer.exe：让 Windows「打开方式」列表里显示
;    「视频播放器」而不是 Exe 名或文件类型描述；
; 2. 修复卸载时残留的 .扩展名 默认关联值：
;    electron-builder 自带的 APP_UNASSOCIATE 只删除 ProgId 和 OpenWithProgids，
;    不会清掉 "Software\Classes\.mp4" 的默认值，卸载后会留下指向不存在 ProgId 的坏关联。

!macro PLAYER_REG_EXT EXT
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithList" "VideoPlayer.exe"
  WriteRegNone SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe\SupportedTypes" ".${EXT}"
!macroend

!macro PLAYER_REG_ALL_EXTS
  !insertmacro PLAYER_REG_EXT "mp4"
  !insertmacro PLAYER_REG_EXT "m4v"
  !insertmacro PLAYER_REG_EXT "mkv"
  !insertmacro PLAYER_REG_EXT "avi"
  !insertmacro PLAYER_REG_EXT "mov"
  !insertmacro PLAYER_REG_EXT "wmv"
  !insertmacro PLAYER_REG_EXT "flv"
  !insertmacro PLAYER_REG_EXT "webm"
  !insertmacro PLAYER_REG_EXT "mpg"
  !insertmacro PLAYER_REG_EXT "mpeg"
  !insertmacro PLAYER_REG_EXT "ts"
  !insertmacro PLAYER_REG_EXT "m2ts"
  !insertmacro PLAYER_REG_EXT "mts"
  !insertmacro PLAYER_REG_EXT "3gp"
  !insertmacro PLAYER_REG_EXT "3g2"
  !insertmacro PLAYER_REG_EXT "rmvb"
  !insertmacro PLAYER_REG_EXT "rm"
  !insertmacro PLAYER_REG_EXT "vob"
  !insertmacro PLAYER_REG_EXT "ogv"
  !insertmacro PLAYER_REG_EXT "ogm"
  !insertmacro PLAYER_REG_EXT "asf"
  !insertmacro PLAYER_REG_EXT "f4v"
  !insertmacro PLAYER_REG_EXT "divx"
  !insertmacro PLAYER_REG_EXT "mxf"
!macroend

!macro PLAYER_UNREG_EXT EXT
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  StrCmp $R0 "ShipinVideoPlayer.Video" 0 +2
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "ShipinVideoPlayer.Video"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithList" "VideoPlayer.exe"
!macroend

!macro PLAYER_UNREG_ALL_EXTS
  !insertmacro PLAYER_UNREG_EXT "mp4"
  !insertmacro PLAYER_UNREG_EXT "m4v"
  !insertmacro PLAYER_UNREG_EXT "mkv"
  !insertmacro PLAYER_UNREG_EXT "avi"
  !insertmacro PLAYER_UNREG_EXT "mov"
  !insertmacro PLAYER_UNREG_EXT "wmv"
  !insertmacro PLAYER_UNREG_EXT "flv"
  !insertmacro PLAYER_UNREG_EXT "webm"
  !insertmacro PLAYER_UNREG_EXT "mpg"
  !insertmacro PLAYER_UNREG_EXT "mpeg"
  !insertmacro PLAYER_UNREG_EXT "ts"
  !insertmacro PLAYER_UNREG_EXT "m2ts"
  !insertmacro PLAYER_UNREG_EXT "mts"
  !insertmacro PLAYER_UNREG_EXT "3gp"
  !insertmacro PLAYER_UNREG_EXT "3g2"
  !insertmacro PLAYER_UNREG_EXT "rmvb"
  !insertmacro PLAYER_UNREG_EXT "rm"
  !insertmacro PLAYER_UNREG_EXT "vob"
  !insertmacro PLAYER_UNREG_EXT "ogv"
  !insertmacro PLAYER_UNREG_EXT "ogm"
  !insertmacro PLAYER_UNREG_EXT "asf"
  !insertmacro PLAYER_UNREG_EXT "f4v"
  !insertmacro PLAYER_UNREG_EXT "divx"
  !insertmacro PLAYER_UNREG_EXT "mxf"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe" "FriendlyAppName" "视频播放器"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe" "ApplicationName" "视频播放器"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe\DefaultIcon" "" "$INSTDIR\VideoPlayer.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe\shell\open" "" "用视频播放器打开"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe\shell\open\command" "" '"$INSTDIR\VideoPlayer.exe" "%1"'
  !insertmacro PLAYER_REG_ALL_EXTS
!macroend

!macro customUnInstall
  !insertmacro PLAYER_UNREG_ALL_EXTS
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\VideoPlayer.exe"
  !insertmacro UPDATEFILEASSOC
!macroend
