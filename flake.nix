{
  description = "Oculog iOS client and FastAPI development tools";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/c59305bab2065cfecc4944690d9eedbb56f3a9fa";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python3.withPackages (ps: [ ps.fastapi ps.uvicorn ]);
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [ nodejs_24 pnpm git curl jq python ];
            shellHook = ''
              export EXPO_NO_TELEMETRY=1
            '' + pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              export NIX_LD="${pkgs.stdenv.cc.bintools.dynamicLinker}"
            '';
          };
        }
      );
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
