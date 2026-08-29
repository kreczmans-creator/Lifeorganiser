plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The vault markdown at the repo root is the single source of truth. Copy it
// into assets at build time so a fresh install has a working vault before the
// user has configured GitHub sync.
val seedVault = tasks.register<Sync>("seedVault") {
    val repoRoot = rootProject.projectDir.parentFile
    into(layout.buildDirectory.dir("generated/seed/seed"))
    from(repoRoot) {
        include("CLAUDE.md", "README.md", "Command Center.md")
        include(
            "00-Inbox/**", "01-Values/**", "02-Goals/**", "03-Projects/**",
            "04-Areas/**", "05-Knowledge/**", "06-People/**", "07-Journal/**",
            "08-Archive/**", "_templates/**",
        )
    }
    // Never fail the build just because the vault moved.
    onlyIf { repoRoot.isDirectory }
}

android {
    namespace = "com.lifeorganiser.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lifeorganiser.app"
        minSdk = 26
        targetSdk = 34
        versionCode = (project.findProperty("appVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("appVersionName") as String?) ?: "1.0"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/seed"))

    // A throwaway key so every build installs as an upgrade instead of forcing
    // an uninstall. It signs a personal sideloaded app and protects nothing.
    signingConfigs {
        create("personal") {
            storeFile = rootProject.file("keystore/lifeorganiser.jks")
            storePassword = "lifeorganiser"
            keyAlias = "lifeorganiser"
            keyPassword = "lifeorganiser"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("personal")
        }
        getByName("debug") {
            signingConfig = signingConfigs.getByName("personal")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

tasks.withType<com.android.build.gradle.tasks.MergeSourceSetFolders>().configureEach {
    dependsOn(seedVault)
}
