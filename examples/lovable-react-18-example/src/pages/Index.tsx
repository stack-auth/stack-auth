import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Sparkles, Zap, Shield, Rocket } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="container mx-auto px-4 pt-20 pb-32 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="inline-block animate-float">
            <div className="bg-primary/10 border border-primary/20 rounded-full px-6 py-2 backdrop-blur-sm">
              <span className="text-sm font-medium bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                ✨ Welcome to the Future
              </span>
            </div>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            Build Something
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Extraordinary
            </span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Transform your ideas into reality with cutting-edge technology and innovative solutions that drive results.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button size="lg" variant="hero" className="text-lg">
              Get Started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg">
              Learn More
            </Button>
          </div>
        </div>
        
        <div className="mt-20 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 blur-3xl opacity-50 animate-glow" />
          <div className="relative bg-card/50 backdrop-blur-sm border border-border rounded-2xl p-8 max-w-4xl mx-auto">
            <div className="aspect-video bg-gradient-to-br from-primary/10 to-accent/10 rounded-xl flex items-center justify-center">
              <Sparkles className="h-20 w-20 text-primary/40" />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Why Choose Us
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Discover the features that make us stand out from the competition
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <Card className="p-8 bg-card/50 backdrop-blur-sm border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
            <div className="bg-primary/10 w-14 h-14 rounded-lg flex items-center justify-center mb-4">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Lightning Fast</h3>
            <p className="text-muted-foreground">
              Experience blazing fast performance that keeps you ahead of the curve.
            </p>
          </Card>
          
          <Card className="p-8 bg-card/50 backdrop-blur-sm border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
            <div className="bg-accent/10 w-14 h-14 rounded-lg flex items-center justify-center mb-4">
              <Shield className="h-7 w-7 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Secure & Reliable</h3>
            <p className="text-muted-foreground">
              Your data is protected with enterprise-grade security measures.
            </p>
          </Card>
          
          <Card className="p-8 bg-card/50 backdrop-blur-sm border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
            <div className="bg-primary/10 w-14 h-14 rounded-lg flex items-center justify-center mb-4">
              <Rocket className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Scale Effortlessly</h3>
            <p className="text-muted-foreground">
              Grow your business without worrying about infrastructure limits.
            </p>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 mb-20">
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5" />
            <div className="relative p-12 text-center space-y-6">
              <h2 className="text-3xl md:text-5xl font-bold">
                Ready to Get Started?
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Join thousands of satisfied users who are already experiencing the difference.
              </p>
              <div className="pt-4">
                <Button size="lg" variant="hero" className="text-lg">
                  Start Your Journey
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default Index;
