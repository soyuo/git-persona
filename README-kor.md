# git-persona

Switch Git identities and GitHub credentials without logging out.

## 요구 사항

- Node.js 20 이상
- Git
- `login`, `logout`, `credentials` 사용을 위한 Git Credential Manager
- SSH fallback을 위해 GitHub에 등록된 SSH key

## 설치

이 저장소의 CLI binary를 전역 npm PATH에 등록합니다.

```bash
npm link
```

명령어가 등록되었는지 확인합니다.

```bash
git-persona --help
git persona --help
```

`npm link`는 현재 작업 사본을 전역으로 연결하므로, 이 저장소의 변경 사항이 CLI 실행에 바로 반영됩니다. 연결을 제거하려면 다음을 실행합니다.

```bash
npm unlink --global git-persona
```

link 없이 저장소에서 직접 실행할 수도 있습니다.

```bash
npm start -- --help
```

패키지는 `git-persona` binary를 제공합니다. PATH에 설치된 경우 Git subcommand 형식도 지원합니다.

```bash
git persona <command>
```

설정 파일은 `~/.git-persona/config.json`에 저장됩니다.

## 언어 설정

CLI는 영어(`en-US`)와 한국어(`ko-KR`)를 지원합니다. 현재 언어를 확인하려면 다음을 실행합니다.

```bash
git persona lang
```

모든 저장소에 적용되는 전역 언어를 설정합니다.

```bash
git persona lang ko-KR
git persona lang en-US
```

현재 저장소에만 적용되는 언어를 설정합니다.

```bash
git persona lang ko-KR --repo
```

저장소별 언어 설정은 해당 저장소에서 전역 언어 설정보다 우선합니다. 다른 저장소는 계속 전역 언어 설정을 사용합니다.

## Migration

파일을 변경하지 않고 현재 Git identity를 확인합니다.

```bash
git persona migration --dry-run
```

확인 후 감지된 identity를 persona로 저장합니다.

```bash
git persona migration
git persona migration --name work
```

`--repo`를 사용하면 현재 저장소의 local Git identity를 읽고, 저장한 persona를 현재 저장소에 연결합니다.

## Persona 관리

옵션을 사용해 persona를 생성, 수정, 조회, 삭제할 수 있습니다.

```bash
git persona add work --name "Work User" --email work@example.com --signing-key ~/.ssh/id_ed25519.pub --gpg-format ssh --commit-gpg-sign true --credential-helper manager
git persona edit work --email updated@example.com
git persona list
git persona remove work
```

현재 활성화된 persona 또는 저장소에 연결된 persona는 삭제할 수 없습니다. 먼저 다른 persona로 전환한 후 다시 시도해야 합니다.

## Persona 전환

전역 Git identity와 GitHub account selector를 전환합니다.

```bash
git persona switch work
```

현재 저장소에만 적용하려면 다음을 사용합니다.

```bash
git persona switch work --repo
```

ID 없이 실행하면 대화형 selector가 열립니다.

```bash
git persona switch
```

저장소 연결은 다음 명령어로 직접 관리할 수 있습니다.

```bash
git persona repo bind work
git persona repo unbind
```

`--repo`는 local Git 설정만 변경합니다. 전역 전환은 사용자 level Git 설정을 변경합니다.

## Credential과 token 보안

로그인은 숨겨진 terminal 입력을 통해 Git Credential Manager에 token을 저장합니다.

```bash
git persona login work
git persona logout work
git persona credentials
```

token은 `config.json`에 저장하지 않으며, 일반 출력에 표시하거나 command-line argument로 받지 않습니다. `credentials`는 일치하는 GitHub account가 GCM에 존재하는지만 표시합니다.

Persona 전환은 `credential.https://github.com.username`을 사용해 GitHub account를 선택합니다. token 자체는 GCM이 관리하는 운영체제 credential store에 보관됩니다.

## HTTPS와 SSH fallback

자동 fallback 동작을 사용하려면 wrapper를 통해 Git 작업을 실행합니다.

```bash
git persona run fetch origin
git persona run push origin main
```

GitHub HTTPS 인증 실패가 감지되면 GitHub HTTPS remote를 SSH로 변경하고 명령을 한 번 재시도합니다. SSH도 실패하면 `git persona login <id>`로 인증하도록 안내합니다.

fallback은 `git persona run`으로 실행한 명령에만 적용되며, 일반 `git` 명령은 가로채지 않습니다.

## 진단

읽기 전용 진단 명령어를 실행합니다.

```bash
git persona current
git persona check
```

`check`는 Git, GCM, 활성 persona 일치 여부, credential 존재 여부, SSH 사용 가능 여부, signing key 설정, 저장소 remote를 확인합니다. warning은 실패 exit code를 발생시키지 않지만, failure는 발생시킵니다.

## 개발

```bash
npm test
npm run check
```

테스트는 임시 저장소와 격리된 Git 설정 파일을 사용하므로 사용자의 전역 Git 설정을 변경하지 않습니다.
