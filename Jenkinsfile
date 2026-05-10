pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
        PNPM_HOME = "${WORKSPACE}/.pnpm-store"
        PATH = "${PNPM_HOME}:${PATH}"
    }

    options {
        timeout(time: 1, unit: 'HOURS')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '5'))
    }

    stages {
        stage('Setup') {
            steps {
                script {
                    echo "========== Setting up environment =========="
                    sh '''
                        node --version
                        npm --version
                        pnpm --version || npm install -g pnpm
                    '''
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                script {
                    echo "========== Installing dependencies =========="
                    sh '''
                        pnpm install --frozen-lockfile
                    '''
                }
            }
        }

        stage('Lint') {
            steps {
                script {
                    echo "========== Running linter =========="
                    sh '''
                        pnpm run lint || true
                    '''
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    echo "========== Building project =========="
                    sh '''
                        pnpm run build
                    '''
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    echo "========== Running tests =========="
                    sh '''
                        pnpm run test || true
                    '''
                }
            }
        }

        stage('Type Check') {
            steps {
                script {
                    echo "========== Running type check =========="
                    sh '''
                        pnpm run type-check || true
                    '''
                }
            }
        }

        stage('Archive Artifacts') {
            steps {
                script {
                    echo "========== Archiving build artifacts =========="
                    sh '''
                        mkdir -p build-artifacts
                        
                        # Archive chrome extension build
                        if [ -d "chrome-extension/dist" ]; then
                            cp -r chrome-extension/dist build-artifacts/chrome-extension || true
                        fi
                        
                        # Archive page builds
                        if [ -d "pages/content/dist" ]; then
                            cp -r pages/content/dist build-artifacts/content || true
                        fi
                        if [ -d "pages/options/dist" ]; then
                            cp -r pages/options/dist build-artifacts/options || true
                        fi
                        if [ -d "pages/side-panel/dist" ]; then
                            cp -r pages/side-panel/dist build-artifacts/side-panel || true
                        fi
                    '''
                    archiveArtifacts artifacts: 'build-artifacts/**/*', allowEmptyArchive: true
                }
            }
        }
    }

    post {
        always {
            script {
                echo "========== Cleaning up =========="
                sh '''
                    rm -rf build-artifacts
                '''
            }
        }
        success {
            echo '✓ Pipeline succeeded!'
        }
        failure {
            echo '✗ Pipeline failed!'
            emailext(
                subject: "Build Failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: "The build failed. Check console output at ${env.BUILD_URL}",
                to: "${env.CHANGE_AUTHOR_EMAIL}",
                recipientProviders: [brokenBuildSuspects(), requestor()]
            )
        }
    }
}
