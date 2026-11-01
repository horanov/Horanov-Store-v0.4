import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme as C } from '../theme';

export function BootScreen() {
  const pulse = useRef(new Animated.Value(0)).current;
  const glide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 880, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 880, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(glide, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(glide, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [pulse, glide]);
  return (
    <SafeAreaView style={s.root} edges={['top','bottom']}>
      <View style={s.ambientTop}/><View style={s.ambientBottom}/>
      <View style={s.center}>
        <Animated.View style={[s.shadow, { transform: [{ scale: pulse.interpolate({ inputRange: [0,1], outputRange: [1,1.07] }) }] }]}>
          <LinearGradient colors={['#FF9F63','#FF762F','#ED541B']} style={s.brandMark}>
            <Text style={s.letter}>H</Text>
          </LinearGradient>
        </Animated.View>
        <Text style={s.name}>Horanov Store</Text>
        <Text style={s.slogan}>Твої додатки, в одному місці ✨</Text>
      </View>
      <View style={s.footer}>
        <View style={s.progressTrack}><Animated.View style={[s.progressBar, { width: glide.interpolate({ inputRange: [0,1], outputRange: ['20%','94%'] }) }]}/></View>
        <Text style={s.loading}>Завантажуємо каталог 🚀</Text>
        <Text style={s.version}>v0.4.9</Text>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#FBFAFD', overflow:'hidden' },
  ambientTop: { position:'absolute', width:310,height:310,borderRadius:155,backgroundColor:'#FFE6D9',top:-165,right:-165,opacity:.7 },
  ambientBottom: { position:'absolute',width:260,height:260,borderRadius:130,backgroundColor:'#EAE9FF',bottom:-165,left:-125,opacity:.6 },
  center: { alignItems:'center',marginTop:-65 },
  shadow: { shadowColor:'#EF7B38',shadowOffset:{width:0,height:17},shadowOpacity:.23,shadowRadius:22,elevation:9 },
  brandMark: { width:104,height:104,borderRadius:30,alignItems:'center',justifyContent:'center' },
  letter: { fontSize:66,fontWeight:'900',color:'#FFF',fontStyle:'italic',letterSpacing:-5 },
  name: { fontWeight:'900',fontSize:29,color:C.text,letterSpacing:-1.2,marginTop:25 },
  slogan: { color:C.muted,fontSize:13,marginTop:8 },
  footer: { position:'absolute',bottom:48,alignItems:'center',gap:15 },
  progressTrack: { width:165,height:6,borderRadius:8,backgroundColor:'#ECEBF0',overflow:'hidden' },
  progressBar: { backgroundColor:C.primary,height:6,borderRadius:8 },
  loading: { fontSize:12,color:'#96949B',fontWeight:'600' },
  version: { marginTop:6,fontSize:11,color:'#BCBBC3' },
});
