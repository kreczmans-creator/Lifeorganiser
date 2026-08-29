plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The vault markdown at the repo root is the single source of truth. It is
// copied into the asset tree at build time so a fresh install has a working
// vault before the user has configured GitHub sync.
//
// This deliberately declares no task outputs. Producing into a directory that
// the asset and lint tasks read would oblige every one of those consumers to
// declare a dependency on it, and missing one fails the build.
val seedVault = tasks.register("seedVault") {
    val repoRoot = rootProject.projectDir.parentFile
    val destination = file("src/main/assets/seed")
    doLast {
        if (!repoRoot.isDirectory) return@doLast
        destination.deleteRecursively()
        project.copy {
            from(repoRoot) {
                include("CLAUDE.md", "README.md", "Command Center.md")
                include(
                    "00-Inbox/**", "01-Values/**", "02-Goals/**", "03-Projects/**",
                    "04-Areas/**", "05-Knowledge/**", "06-People/**", "07-Journal/**",
                    "08-Archive/**", "_templates/**",
                )
            }
            into(destination)
        }
    }
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

// preBuild is the root of the Android task graph, so the seed is in place
// before assets are merged — and it avoids depending on AGP task classes.
tasks.named("preBuild") {
    dependsOn(seedVault)
}
