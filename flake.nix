{
  description = "Oculog Expo and FastAPI development tools";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/c59305bab2065cfecc4944690d9eedbb56f3a9fa";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
              android_sdk.accept_license = true;
            };
          };

          isAndroidHost = system == "x86_64-linux";

          android = pkgs.androidenv.composeAndroidPackages {
            platformVersions = [ "35" ];
            buildToolsVersions = [ "35.0.0" ];
            includeEmulator = true;
            includeSystemImages = true;
            systemImageTypes = [ "google_apis" ];
            abiVersions = [ "x86_64" ];
            includeNDK = false;
            includeCmake = false;
          };
          python = pkgs.python3.withPackages (ps: [
            ps.fastapi
            ps.uvicorn
          ]);
        in
        {
          default = pkgs.mkShell {
            packages =
              (with pkgs; [
                nodejs_24
                pnpm
                git
                curl
                jq
                python
              ])
              ++ pkgs.lib.optionals isAndroidHost [
                android.androidsdk
                pkgs.jdk17
              ];
            shellHook = ''
              export EXPO_NO_TELEMETRY=1
            ''
            + pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              # Project Biome wrapper uses this loader for the pinned npm binary.
              export NIX_LD="${pkgs.stdenv.cc.bintools.dynamicLinker}"
            ''
            + pkgs.lib.optionalString isAndroidHost ''
              export ANDROID_HOME="${android.androidsdk}/libexec/android-sdk"
              export ANDROID_SDK_ROOT="$ANDROID_HOME"
              export JAVA_HOME="${pkgs.jdk17.home}"
              export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
            '';
          };
        }
      );
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
