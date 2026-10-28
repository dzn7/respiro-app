---
name: respiro-release
description: Gerar build e release do Respiro (.app e .dmg para macOS). Use quando pedirem build, pacote, versão nova ou release.
---

# Build e release

1. `npm run verify` precisa passar. Sem isso, não gere build.
2. Suba a versão em `package.json` (semver: correção = patch, função nova = minor).
3. `npm run release` gera o ícone a partir de `logo.jpg` (`scripts/icon.js` + `iconutil`) e, em `dist/`:
   - `Respiro-darwin-<arch>/Respiro.app` (via `@electron/packager`, só `src/` e `package.json` entram no pacote)
   - `Respiro-<versão>-<arch>.dmg`: janela 640×440 com fundo Retina, ícones posicionados e ícone do volume (`UI.md › Instalador`). O Finder abre e fecha a janela do volume por alguns segundos; na primeira vez o macOS pede permissão para controlar o Finder.
   - Ejete qualquer volume "Respiro" montado antes; com ele montado o build vira "Respiro 1".
4. Smoke test do `.app` gerado: abra, espere a análise, abra um detalhe, rode uma simulação. Feche.
5. Sem assinatura nem notarização por enquanto: na primeira abertura em outro Mac, clique com o botão direito › Abrir. Assinar exige `Developer ID` e `notarytool`; peça as credenciais antes de tentar.
6. Publicar (GitHub Release, site) só com pedido explícito do usuário.

Saída: caminhos dos arquivos, tamanho do `.dmg`, versão e o resultado do smoke test.
